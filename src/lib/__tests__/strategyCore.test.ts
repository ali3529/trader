import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { fairValueGaps, nearestExitLevel, nearestSupport, orderBlocks } from "../strategy/levels";
import { detectBullishPatterns } from "../strategy/patterns";
import { qualifiesEntry } from "../strategy/scoring";
import { analyzeStructure, isBullishStructure } from "../strategy/structure";
import type { Candle, CriterionId, CriterionResult, Level } from "../types";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: 1_700_000_000_000 + index * 3_600_000,
    open,
    high,
    low,
    close,
    volume: 10,
  };
}

describe("هسته تصمیم ورود", () => {
  const ids: CriterionId[] = [
    "structure",
    "location",
    "pattern",
    "momentum15m",
    "rsi",
    "volume",
    "riskReward",
    "validStop",
  ];

  function criteria(failedId?: CriterionId): CriterionResult[] {
    return ids.map((id) => ({
      id,
      label: id,
      passed: id !== failedId,
      critical: ["structure", "location", "pattern", "momentum15m", "riskReward", "validStop"].includes(id),
      detail: "test",
    }));
  }

  it("فیلتر نهایی مومنتوم ۱۵ دقیقه حتی با امتیاز ۷ از ۸ ورود را وتو می‌کند", () => {
    expect(qualifiesEntry(criteria("momentum15m"), 6)).toBe(false);
  });

  it("با عبور همه شروط حیاتی و حداقل ۶ تأیید اجازه ورود می‌دهد", () => {
    expect(qualifiesEntry(criteria("rsi"), 6)).toBe(true);
  });
});

describe("Price Action روی کندل بسته‌شده", () => {
  it("Bullish Engulfing را فقط روی آخرین کندل آرایه تشخیص می‌دهد", () => {
    const candles = [
      candle(0, 100, 102, 98, 101),
      candle(1, 101, 103, 99, 102),
      candle(2, 105, 106, 99, 100),
      candle(3, 99, 107, 98, 106),
    ];
    expect(detectBullishPatterns(candles, DEFAULT_CONFIG).map((hit) => hit.name)).toContain("bullish_engulfing");
  });

  it("ساختار HH/HL صعودی را با CHoCH و سپس BOS شناسایی می‌کند", () => {
    const candles = [
      candle(0, 98, 100, 96, 99),
      candle(1, 104, 110, 100, 106),
      candle(2, 100, 105, 90, 98),
      candle(3, 108, 120, 100, 115),
      candle(4, 102, 110, 95, 105),
      candle(5, 112, 125, 105, 120),
      candle(6, 108, 115, 100, 110),
    ];
    const structure = analyzeStructure(candles, 1);
    expect(structure.swings.map((swing) => swing.kind)).toEqual(["HH", "HL", "HH", "HL", "HH"]);
    expect(structure.events.map((event) => event.type)).toEqual(["CHOCH_UP", "BOS_UP"]);
    expect(isBullishStructure(structure)).toBe(true);
  });
});

describe("نواحی دوطرفه Order Block و FVG", () => {
  it("Order Block نزولی را به‌عنوان supply ثبت می‌کند", () => {
    const candles = [
      candle(0, 100, 101, 99, 100.5),
      candle(1, 100.5, 102, 100, 101),
      candle(2, 101, 102, 100, 101.5),
      candle(3, 101.5, 103, 101, 102),
      candle(4, 102, 103, 101, 102.5),
      candle(5, 100, 103, 99, 102),
      candle(6, 102, 103, 89, 90),
      candle(7, 91, 94, 88, 92),
    ];
    const levels = orderBlocks(candles, {
      ...DEFAULT_CONFIG,
      orderBlockBodyPeriod: 3,
      orderBlockImpulseMult: 1,
    });
    expect(levels).toContainEqual(expect.objectContaining({ kind: "order_block", side: "supply", price: 99 }));
  });

  it("FVG نزولی را supply و FVG صعودی را demand ثبت می‌کند", () => {
    const bearish = [
      candle(0, 105, 110, 100, 106),
      candle(1, 108, 109, 90, 92),
      candle(2, 93, 95, 85, 90),
    ];
    const bullish = [
      candle(0, 95, 100, 90, 94),
      candle(1, 92, 110, 91, 108),
      candle(2, 107, 115, 105, 112),
    ];
    expect(fairValueGaps(bearish, DEFAULT_CONFIG)[0]).toEqual(
      expect.objectContaining({ kind: "fvg", side: "supply", price: 97.5 }),
    );
    expect(fairValueGaps(bullish, DEFAULT_CONFIG)[0]).toEqual(
      expect.objectContaining({ kind: "fvg", side: "demand", price: 102.5 }),
    );
  });

  it("سطح supply فقط برای خروج و demand فقط برای حمایت استفاده می‌شود", () => {
    const levels: Level[] = [
      { price: 95, kind: "fvg", side: "supply", strength: 2, time: 1 },
      { price: 90, kind: "order_block", side: "demand", strength: 3, time: 2 },
      { price: 105, kind: "fvg", side: "demand", strength: 2, time: 3 },
      { price: 110, kind: "order_block", side: "supply", strength: 3, time: 4 },
    ];
    expect(nearestSupport(levels, 100)?.price).toBe(90);
    expect(nearestExitLevel(levels, 100)?.price).toBe(110);
  });
});
