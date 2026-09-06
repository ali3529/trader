import { defineHandler } from "nitro";
import { getQuery, createError } from "nitro/h3";
import { publicGet, assertValidSymbol } from "../../../utils/nobitex";

const VALID_RESOLUTIONS = new Set(["60", "300", "900", "1800", "3600", "14400", "86400"]);

interface RawCandles {
  time?: number[];
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
}

/** پروکسی کندل‌های نوبیتکس — خروجی نرمال‌شده برای موتور و چارت */
export default defineHandler(async (event) => {
  const q = getQuery(event);
  const symbol = assertValidSymbol(String(q.symbol ?? "").toUpperCase());
  const resolution = String(q.resolution ?? "3600");
  if (!VALID_RESOLUTIONS.has(resolution)) throw createError({ statusCode: 400, statusMessage: "resolution نامعتبر" });
  const from = Number(q.from);
  const to = Number(q.to);
  if (!isFinite(from) || !isFinite(to) || to <= from) throw createError({ statusCode: 400, statusMessage: "بازه زمانی نامعتبر" });

  // مستندات نوبیتکس: from/to در candlestore/light بر حسب ثانیه یونیکس هستند؛
  // فرانت‌اند میلی‌ثانیه می‌فرستد، پس تبدیل می‌کنیم و زمان پاسخ را به میلی‌ثانیه برمی‌گردانیم.
  const raw = (await publicGet("/market/candlestore/light", {
    symbol,
    resolution,
    from: String(Math.floor(from / 1000)),
    to: String(Math.floor(to / 1000)),
  })) as RawCandles[] | RawCandles;

  const data: RawCandles = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
  const nums = (arr: number[] | undefined) => (arr ?? []).map(Number);
  if (!Array.isArray(data.time) || data.time.length === 0) {
    throw createError({
      statusCode: 502,
      statusMessage: `نوبیتکس کندلی برنگرداند — پاسخ خام: ${JSON.stringify(raw).slice(0, 200)}`,
    });
  }
  return {
    time: nums(data.time).map((t) => t * 1000),
    open: nums(data.open),
    high: nums(data.high),
    low: nums(data.low),
    close: nums(data.close),
    volume: nums(data.volume),
  };
});
