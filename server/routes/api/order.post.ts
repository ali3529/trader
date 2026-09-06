import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { privateRequest, loadKeys, assertValidSymbol } from "../../utils/nobitex";

interface Body {
  symbol?: string;
  side?: "buy" | "sell";
  type?: "market" | "limit";
  qty?: number;
  price?: number;
}

/**
 * ثبت سفارش اسپات طبق مستندات رسمی نوبیتکس (POST /api/orders):
 * - type: "buy" | "sell" (کوچک)
 * - symbol: نام بازار با حروف کوچک (btcirt)
 * - orderType: "LIMIT" (پیش‌فرض) | "MARKET"
 * - quantity: مقدار سفارش؛ price فقط برای LIMIT الزامی است
 * پاسخ موفق: { status: "OK", order: { id, uuid, status, filledQuantity, ... } }
 * فقط اگر معامله واقعی با تأیید روشن کاربر فعال شده باشد.
 */
export default defineHandler(async (event) => {
  const keys = loadKeys();
  if (!keys || !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
  }
  const body = await readBody<Body>(event);
  const symbol = assertValidSymbol(String(body?.symbol ?? "").toUpperCase()).toLowerCase();
  const type = body?.side === "sell" ? "sell" : body?.side === "buy" ? "buy" : null;
  if (!type) throw createError({ statusCode: 400, statusMessage: "side نامعتبر" });
  const quantity = Number(body?.qty);
  if (!isFinite(quantity) || quantity <= 0) throw createError({ statusCode: 400, statusMessage: "qty نامعتبر" });

  const orderType = body?.type === "limit" ? "LIMIT" : "MARKET";
  const order: Record<string, unknown> = {
    type,
    symbol,
    quantity: String(quantity),
    orderType,
  };
  if (orderType === "LIMIT") {
    const price = Number(body?.price);
    if (!isFinite(price) || price <= 0) throw createError({ statusCode: 400, statusMessage: "price نامعتبر" });
    order.price = String(price);
  }

  const result = (await privateRequest("POST", "/orders", { body: order })) as {
    order?: { id?: number; uuid?: string; status?: string; filledQuantity?: string };
  };
  return {
    ok: true,
    orderId: result.order?.id ?? null,
    orderUuid: result.order?.uuid ?? null,
    orderStatus: result.order?.status ?? null,
    filledQuantity: Number(result.order?.filledQuantity ?? 0) || 0,
  };
});
