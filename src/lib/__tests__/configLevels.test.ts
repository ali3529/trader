import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_SYMBOLS, MAX_WATCH_SYMBOLS, normalizeConfig } from "../config";
import { buildGrid, nearestExitLevel } from "../strategy/levels";
import type { Candle, Level } from "../types";

describe("تنظیمات ایمنی", () => {
  it("فهرست پیش‌فرض فقط شامل نمادهای انتخاب‌شده و در محدوده ظرفیت رانر است", () => {
    expect(DEFAULT_SYMBOLS).toHaveLength(15);
    expect(DEFAULT_SYMBOLS).not.toContain("TONIRT");
    expect(DEFAULT_SYMBOLS).toEqual(expect.arrayContaining([
      "ZECIRT",
      "ENAIRT",
      "HYPEIRT",
      "TAOIRT",
      "AEROIRT",
      "USELESSIRT",
      "ONDOIRT",
      "SUIIRT",
    ]));
    expect(DEFAULT_SYMBOLS.length).toBeLessThanOrEqual(MAX_WATCH_SYMBOLS);
  });

  it("محدودیت‌های حیاتی با localStorage قابل عبور نیستند", () => {
    const cfg = normalizeConfig({
      ...DEFAULT_CONFIG,
      riskPerTradePct: 9,
      minConfirmations: 2,
      minRR: 0.5,
      maxOpenPositions: 20,
      maxEngagedCapitalPct: 80,
      apiMinIntervalMs: 1,
      apiMaxRetries: 99,
      apiRetryDelayMs: 1,
    });
    expect(cfg.riskPerTradePct).toBe(1);
    expect(cfg.minConfirmations).toBe(6);
    expect(cfg.minRR).toBe(1.5);
    expect(cfg.maxOpenPositions).toBe(4);
    expect(cfg.maxEngagedCapitalPct).toBe(12);
    expect(cfg.apiMinIntervalMs).toBe(12_000);
    expect(cfg.apiMaxRetries).toBe(3);
    expect(cfg.apiRetryDelayMs).toBe(30_000);
  });
});

describe("سطوح و Grid", () => {
  it("Grid دقیقاً ۲۵ سطح شامل ابتدا و انتهای بازه تولید می‌کند", () => {
    const start = 1_700_000_000_000;
    const candles: Candle[] = Array.from({ length: 40 }, (_, index) => ({
      time: start + index * 3_600_000,
      open: 100 + index,
      high: 110 + index * 2,
      low: 90 - index,
      close: 105 + index,
      volume: 10,
    }));
    const grid = buildGrid(candles, DEFAULT_CONFIG, 5);
    expect(grid.enabled).toBe(true);
    expect(grid.levels).toHaveLength(25);
    expect(grid.levels[0]).toBeCloseTo(grid.support, 8);
    expect(grid.levels.at(-1)).toBeCloseTo(grid.resistance, 8);
  });

  it("Order Block و FVG بالای قیمت را نیز مانع خروج می‌داند", () => {
    const levels: Level[] = [
      { price: 110, kind: "resistance", strength: 3, time: 1 },
      { price: 105, kind: "order_block", strength: 2, time: 2 },
      { price: 107, kind: "fvg", strength: 2, time: 3 },
    ];
    expect(nearestExitLevel(levels, 100)?.price).toBe(105);
  });
});
