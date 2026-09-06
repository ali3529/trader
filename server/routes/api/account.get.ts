import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { decodePrivateKey, privateRequest, loadKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { loadOrderLedger, recordBotOrder } from "../../utils/orderLedger";

interface WalletBalance {
  balance?: string | number;
  blocked?: string | number;
}

/**
 * موجودی‌ها و سفارش‌های باز — برای همگام‌سازی پس از قطع و وصل اتصال.
 * طبق مستندات رسمی نوبیتکس:
 * - GET /v2/wallets → { wallets: { BTC: { balance, blocked, ... } } }
 * - GET /market/orders/list?status=open → { orders: [...] }
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  const keys = loadKeys();
  if (!keys) throw createError({ statusCode: 400, statusMessage: "کلید API ذخیره نشده است" });
  try {
    decodePrivateKey(keys.apiSecret);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "کلید قدیمی است؛ کلید Ed25519 جدید را در تنظیمات ذخیره کنید" });
  }
  const walletRes = (await privateRequest("GET", "/v2/wallets", { query: { type: "spot" } })) as {
    wallets?: Record<string, WalletBalance | string | number>;
  };
  const orders = (await privateRequest("GET", "/market/orders/list", { query: { status: "open", details: "2" } })) as {
    orders?: unknown[];
  };
  const balances: Record<string, number> = {};
  const totalBalances: Record<string, number> = {};
  const blockedBalances: Record<string, number> = {};
  for (const [coin, value] of Object.entries(walletRes.wallets ?? {})) {
    const total = Number(typeof value === "object" && value !== null ? value.balance ?? 0 : value);
    const blocked = Number(typeof value === "object" && value !== null ? value.blocked ?? 0 : 0);
    const available = total - blocked;
    if (isFinite(total) && total > 0) totalBalances[coin] = total;
    if (isFinite(blocked) && blocked > 0) blockedBalances[coin] = blocked;
    if (isFinite(available) && available > 0) balances[coin] = available;
  }
  const botOrders = await refreshUnresolvedOrders(loadOrderLedger());
  return {
    balances,
    totalBalances,
    blockedBalances,
    openOrders: orders.orders ?? [],
    botOrders,
  };
});

async function refreshUnresolvedOrders(records: ReturnType<typeof loadOrderLedger>) {
  const unresolved = records.filter((record) => record.reconciliationRequired).slice(-3);
  for (const record of unresolved) {
    try {
      const response = await privateRequest("POST", "/market/orders/status", {
        body: { id: record.orderId },
        retryable: true,
      }) as { order?: { status?: string; matchedAmount?: string | number; averagePrice?: string | number; price?: string | number } };
      if (!response.order) continue;
      const status = String(response.order.status ?? record.status);
      const terminal = ["done", "canceled"].includes(status.toLowerCase());
      const updated = {
        ...record,
        status,
        filledQty: terminal ? Number(response.order.matchedAmount ?? 0) || 0 : record.filledQty,
        averagePrice: terminal
          ? (Number(response.order.averagePrice ?? response.order.price ?? 0) || 0) / 10
          : record.averagePrice,
        reconciliationRequired: !terminal,
      };
      recordBotOrder(updated);
      Object.assign(record, updated);
    } catch {
      // وضعیت همچنان مبهم می‌ماند و سمت مرورگر اعمال نمی‌شود.
    }
  }
  return records;
}
