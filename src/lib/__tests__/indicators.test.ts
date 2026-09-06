import { describe, expect, it } from "vitest";
import {
  aggregateCandles,
  atr,
  lastAtr,
  lastRsi,
  rsi,
  sma,
  swingPoints,
  volumeRatio,
} from "../strategy/indicators";
import type { Candle } from "../types";

const c = (time: number, open: number, high: number, low: number, close: number, volume = 1): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

/** کندل‌های صعودی پیوسته: close هر کندل یکی بیشتر از قبلی */
function risingSeries(n: number, start = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const price = start + i;
    return c(i * 900_000, price - 0.5, price + 0.5, price - 1, price);
  });
}

function fallingSeries(n: number, start = 200): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const price = start - i;
    return c(i * 900_000, price + 0.5, price + 1, price - 0.5, price);
  });
}

describe("rsi", () => {
  it("قبل از تکمیل دوره فقط null برمی‌گرداند (بدون look-ahead)", () => {
    const series = rsi(risingSeries(14), 14);
    expect(series.every((v) => v === null)).toBe(true);
  });

  it("در روند کاملاً صعودی برابر ۱۰۰ است", () => {
    expect(lastRsi(risingSeries(30), 14)).toBe(100);
  });

  it("در روند کاملاً نزولی برابر ۰ است", () => {
    expect(lastRsi(fallingSeries(30), 14)).toBeCloseTo(0, 6);
  });

  it("همیشه بین ۰ و ۱۰۰ می‌ماند", () => {
    const candles = risingSeries(20).concat(fallingSeries(20));
    for (const v of rsi(candles, 14)) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("atr", () => {
  it("برای کندل‌های با دامنه ثابت برابر همان دامنه است", () => {
    const candles = Array.from({ length: 20 }, (_, i) => c(i * 900_000, 100, 105, 95, 100));
    expect(lastAtr(candles, 14)).toBeCloseTo(10, 6);
  });

  it("قبل از تکمیل دوره null است", () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(i * 900_000, 100, 105, 95, 100));
    expect(atr(candles, 14).every((v) => v === null)).toBe(true);
    expect(lastAtr(candles, 14)).toBeNull();
  });

  it("همیشه مثبت است", () => {
    const v = lastAtr(risingSeries(30), 14);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
  });
});

describe("sma", () => {
  it("میانگین N مقدار آخر را برمی‌گرداند", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it("با داده ناکافی null است", () => {
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe("volumeRatio", () => {
  it("حجم آخرین کندل را با میانگین دوره قبل مقایسه می‌کند", () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(i, 1, 2, 0, 1, 100));
    candles.push(c(10, 1, 2, 0, 1, 250));
    expect(volumeRatio(candles, 10)).toBeCloseTo(2.5, 6);
  });

  it("با داده ناکافی null است", () => {
    expect(volumeRatio(risingSeries(5), 10)).toBeNull();
  });
});

describe("swingPoints", () => {
  it("قله و دره را با تأیید دو کندل در هر طرف پیدا می‌کند", () => {
    const candles = [
      c(0, 10, 11, 9, 10),
      c(1, 10, 12, 9, 11),
      c(2, 11, 15, 10, 14), // قله
      c(3, 14, 14, 10, 11),
      c(4, 11, 12, 8, 9),
      c(5, 9, 10, 7, 8), // دره
      c(6, 8, 12, 7.5, 11),
      c(7, 11, 13, 10, 12),
    ];
    const swings = swingPoints(candles, 2);
    expect(swings.some((s) => s.type === "high" && s.index === 2 && s.price === 15)).toBe(true);
    expect(swings.some((s) => s.type === "low" && s.index === 5 && s.price === 7)).toBe(true);
  });

  it("آخرین کندل‌ها بدون تأیید کافی swing نمی‌شوند (بدون look-ahead)", () => {
    const candles = risingSeries(6).map((x, i) => (i === 5 ? c(x.time, x.open, 999, x.low, x.close) : x));
    const swings = swingPoints(candles, 2);
    expect(swings.some((s) => s.index === 5)).toBe(false);
  });
});

describe("aggregateCandles", () => {
  it("۱۵ دقیقه را درست به ۱ ساعته تبدیل می‌کند", () => {
    const base = 1_700_000_000_000;
    const candles: Candle[] = [];
    for (let i = 0; i < 8; i++) {
      const p = 100 + i;
      candles.push(c(base + i * 900_000, p, p + 2, p - 2, p + 1, 10));
    }
    const hourly = aggregateCandles(candles, 4);
    expect(hourly).toHaveLength(2);

    const first = hourly[0];
    expect(first.time).toBe(candles[0].time);
    expect(first.open).toBe(candles[0].open);
    expect(first.close).toBe(candles[3].close);
    expect(first.high).toBe(Math.max(...candles.slice(0, 4).map((x) => x.high)));
    expect(first.low).toBe(Math.min(...candles.slice(0, 4).map((x) => x.low)));
    expect(first.volume).toBe(40);
  });

  it("کندل ناقص آخر را حذف می‌کند (فقط کندل بسته‌شده)", () => {
    const candles = risingSeries(10);
    const hourly = aggregateCandles(candles, 4);
    expect(hourly).toHaveLength(2); // ۱۰ کندل → ۲ گروه کامل
  });

  it("با factor=1 همان داده را برمی‌گرداند", () => {
    const candles = risingSeries(5);
    expect(aggregateCandles(candles, 1)).toEqual(candles);
  });
});
