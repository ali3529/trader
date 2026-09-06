import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { privateRequest, loadKeys } from "../../utils/nobitex";

interface WalletBalance {
  available?: string | number;
  locked?: string | number;
}

/**
 * موجودی‌ها و سفارش‌های باز — برای همگام‌سازی پس از قطع و وصل اتصال.
 * طبق مستندات رسمی نوبیتکس:
 * - GET /api/users/wallets/balance → { balances: { btc: { available, locked, ... } } }
 * - GET /api/orders?status=ACTIVE → { orders: [...], total }
 */
export default defineHandler(async () => {
  if (!loadKeys()) throw createError({ statusCode: 400, statusMessage: "کلید API ذخیره نشده است" });
  const walletRes = (await privateRequest("GET", "/users/wallets/balance")) as {
    balances?: Record<string, WalletBalance | string | number>;
  };
  const orders = (await privateRequest("GET", "/orders", { query: { status: "ACTIVE" } })) as {
    orders?: unknown[];
    total?: number;
  };
  const balances: Record<string, number> = {};
  for (const [coin, value] of Object.entries(walletRes.balances ?? {})) {
    const raw = typeof value === "object" && value !== null ? value.available : value;
    const n = Number(raw);
    if (isFinite(n) && n > 0) balances[coin] = n;
  }
  return { balances, openOrders: orders.orders ?? [] };
});
