import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { publicGet, assertValidSymbol } from "../../../utils/nobitex";

/**
 * پروکسی دفتر سفارش‌ها برای سنجش نقدشوندگی — طبق مستندات رسمی نوبیتکس:
 * GET /market/orderbook/{SYMBOL} — مثال: /market/orderbook/BTCIRT
 * پاسخ: { asks: [[price, qty], ...], bids: [...] }
 */
export default defineHandler(async (event) => {
  const q = getQuery(event);
  const symbol = assertValidSymbol(String(q.symbol ?? "").toUpperCase());
  const raw = (await publicGet(`/market/orderbook/${symbol}`, {})) as {
    asks?: (string | number)[][];
    bids?: (string | number)[][];
  };
  const toNums = (rows: (string | number)[][] | undefined) =>
    (rows ?? []).map((r) => [Number(r[0]), Number(r[1])]);
  return { asks: toNums(raw.asks), bids: toNums(raw.bids) };
});
