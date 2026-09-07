import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { publicGet, assertValidSymbol } from "../../../utils/nobitex";
import { demoOrderBook } from "../../../utils/demoData";
import { getExchangeProvider } from "../../../utils/exchangePrefs";
import { fetchOrderBook as ramzinexOrderBook } from "../../../utils/ramzinex";

/**
 * پروکسی دفتر سفارش‌ها برای سنجش نقدشوندگی — طبق مستندات رسمی نوبیتکس:
 * GET /v3/orderbook/{SYMBOL} — مثال: /v3/orderbook/BTCIRT
 * پاسخ: { asks: [[price, qty], ...], bids: [...] }
 * اگر نوبیتکس از این شبکه در دسترس نباشد، داده شبیه‌سازی‌شدهٔ برچسب‌دار (source:"demo") برمی‌گردد.
 */
export default defineHandler(async (event) => {
  const q = getQuery(event);
  const symbol = assertValidSymbol(String(q.symbol ?? "").toUpperCase());
  if ((await getExchangeProvider()) === "ramzinex") {
    try {
      const book = await ramzinexOrderBook(symbol);
      return { asks: book.asks, bids: book.bids, source: "live" as const };
    } catch (err) {
      console.log(`[ramzinex] orderbook unreachable for ${symbol} (${(err as Error).message}) -> demo data`);
      return demoOrderBook(symbol);
    }
  }
  let raw: { asks?: (string | number)[][]; bids?: (string | number)[][] };
  try {
    raw = (await publicGet(`/v3/orderbook/${symbol}`, {})) as {
      asks?: (string | number)[][];
      bids?: (string | number)[][];
    };
  } catch (err) {
    console.log(`[nobitex] orderbook unreachable for ${symbol} (${(err as Error).message}) -> demo data`);
    return demoOrderBook(symbol);
  }
  const toNums = (rows: (string | number)[][] | undefined) =>
    (rows ?? []).map((r) => [Number(r[0]), Number(r[1])]);
  return { asks: toNums(raw.asks), bids: toNums(raw.bids), source: "live" as const };
});
