import { defineHandler } from "nitro";
import { getQuery, createError } from "nitro/h3";
import { publicGet, assertValidSymbol } from "../../../utils/nobitex";
import { demoCandles } from "../../../utils/demoData";
import { getExchangeProvider } from "../../../utils/exchangePrefs";
import { fetchCandles as ramzinexCandles } from "../../../utils/ramzinex";

const RESOLUTION_MAP: Record<string, string> = {
  "60": "1",
  "300": "5",
  "900": "15",
  "1800": "30",
  "3600": "60",
  "10800": "180",
  "14400": "240",
  "21600": "360",
  "43200": "720",
  "86400": "D",
};

interface RawCandles {
  s?: "ok" | "no_data" | "error";
  errmsg?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

/** پروکسی کندل‌های نوبیتکس — خروجی نرمال‌شده برای موتور و چارت */
export default defineHandler(async (event) => {
  const q = getQuery(event);
  const symbol = assertValidSymbol(String(q.symbol ?? "").toUpperCase());
  const resolution = String(q.resolution ?? "3600");
  const upstreamResolution = RESOLUTION_MAP[resolution];
  if (!upstreamResolution) throw createError({ statusCode: 400, statusMessage: "resolution نامعتبر" });
  const from = Number(q.from);
  const to = Number(q.to);
  if (!isFinite(from) || !isFinite(to) || to <= from) throw createError({ statusCode: 400, statusMessage: "بازه زمانی نامعتبر" });

  // رمزینکس: /chart/tv/history همان قالب UDF را دارد (زمان ثانیه)
  if ((await getExchangeProvider()) === "ramzinex") {
    try {
      const minutes = Number(resolution) >= 60 ? Number(resolution) / 60 : Number(resolution);
      const rz = await ramzinexCandles(symbol, minutes, from / 1000, to / 1000);
      return {
        time: rz.t.map((t) => t * 1000),
        open: rz.o,
        high: rz.h,
        low: rz.l,
        close: rz.c,
        volume: rz.v,
        source: "live" as const,
      };
    } catch (err) {
      console.log(`[ramzinex] candles unreachable for ${symbol} (${(err as Error).message}) -> demo data`);
      return demoCandles(symbol, Number(resolution), from, to);
    }
  }

  // مستندات نوبیتکس: from/to در UDF history بر حسب ثانیه یونیکس هستند؛
  // فرانت‌اند میلی‌ثانیه می‌فرستد، پس تبدیل می‌کنیم و زمان پاسخ را به میلی‌ثانیه برمی‌گردانیم.
  let raw: RawCandles[] | RawCandles;
  try {
    raw = (await publicGet("/market/udf/history", {
      symbol,
      resolution: upstreamResolution,
      from: String(Math.floor(from / 1000)),
      to: String(Math.floor(to / 1000)),
    })) as RawCandles[] | RawCandles;
  } catch (err) {
    // نوبیتکس از این شبکه در دسترس نیست (مثلاً محیط پیش‌نمایش خارج از ایران) —
    // به‌جای شکست کامل، داده شبیه‌سازی‌شدهٔ برچسب‌دار برمی‌گردد.
    console.log(`[nobitex] upstream unreachable for ${symbol} (${(err as Error).message}) -> demo data`);
    return demoCandles(symbol, Number(resolution), from, to);
  }

  const data: RawCandles = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
  const nums = (arr: number[] | undefined) => (arr ?? []).map(Number);
  if (data.s === "no_data") {
    return { time: [], open: [], high: [], low: [], close: [], volume: [], source: "live" as const };
  }
  if (data.s === "error" || !Array.isArray(data.t)) {
    throw createError({
      statusCode: 502,
      statusMessage: data.errmsg ?? `نوبیتکس کندلی برنگرداند — پاسخ خام: ${JSON.stringify(raw).slice(0, 200)}`,
    });
  }
  return {
    time: nums(data.t).map((t) => t * 1000),
    open: nums(data.o),
    high: nums(data.h),
    low: nums(data.l),
    close: nums(data.c),
    volume: nums(data.v),
    source: "live" as const,
  };
});
