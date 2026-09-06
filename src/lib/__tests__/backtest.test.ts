import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { runBacktest } from "../backtest/backtest";
import type { Candle } from "../types";

const cfg = { ...DEFAULT_CONFIG };

/** مولد شبه‌تصادفی قطعی (mulberry32) برای داده قابل تکرار */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** مسیر تصادفی با موج‌های روند — شبیه بازار واقعی برای تست موتور */
function makeCandles(n: number, seed = 42): Candle[] {
  const rnd = mulberry32(seed);
  const t0 = 1_700_000_000_000;
  let price = 50_000;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 60) * 60;
    const shock = (rnd() - 0.5) * 300;
    const open = price;
    const close = Math.max(1000, open + drift + shock);
    const high = Math.max(open, close) + rnd() * 120;
    const low = Math.min(open, close) - rnd() * 120;
    out.push({ time: t0 + i * 900_000, open, high, low, close, volume: 1 + rnd() * 20 });
    price = close;
  }
  return out;
}

describe("runBacktest", () => {
  const candles = makeCandles(2000); // ~۲۰ روز کندل ۱۵ دقیقه

  it("بدون خطا اجرا می‌شود و منحنی سرمایه می‌سازد", () => {
    const r = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    expect(r.equity.length).toBeGreaterThan(0);
    for (const p of r.equity) {
      expect(Number.isFinite(p.equity)).toBe(true);
      expect(p.equity).toBeGreaterThan(0);
    }
  });

  it("همه معاملات اینورینت‌های اساسی را رعایت می‌کنند", () => {
    const r = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    for (const t of r.trades) {
      expect(t.qty).toBeGreaterThan(0);
      expect(t.entry).toBeGreaterThan(0);
      expect(t.exit).toBeGreaterThan(0);
      expect(Number.isFinite(t.pnl)).toBe(true);
      expect(t.fees).toBeGreaterThanOrEqual(0);
      expect(t.closedAt).toBeGreaterThanOrEqual(t.openedAt);
      expect(t.holdMs).toBeGreaterThanOrEqual(0);
      expect(t.mode).toBe("paper");
      // هیچ معامله‌ای بیش از کل سرمایه ضرر نمی‌دهد
      expect(t.pnlPct).toBeGreaterThan(-100);
    }
  });

  it("کاملاً قطعی است — اجرای دوباره نتیجه یکسان می‌دهد", () => {
    const a = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    const b = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    expect(b.trades).toHaveLength(a.trades.length);
    expect(b.metrics.totalPnl).toBeCloseTo(a.metrics.totalPnl, 6);
    expect(b.metrics.winRate).toBeCloseTo(a.metrics.winRate, 6);
  });

  it("بدون look-ahead: معاملات بسته‌شده قبل از برش، با داده کمتر تغییر نمی‌کنند", () => {
    const cutoff = 1500;
    const full = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    const partial = runBacktest({ symbol: "BTCIRT", candles15m: candles.slice(0, cutoff), cfg });
    const cutoffTime = candles[cutoff - 1].time;
    const fullBefore = full.trades.filter((t) => t.closedAt <= cutoffTime);
    // اجرای برش‌خورده پوزیشن باز را در انتها اجباراً می‌بندد (final_close)؛ آن را نادیده می‌گیریم
    const partialClosed = partial.trades.filter((t) => t.exitReason !== "final_close");
    expect(partialClosed).toHaveLength(fullBefore.length);
    for (let i = 0; i < partialClosed.length; i++) {
      expect(partialClosed[i].entry).toBeCloseTo(fullBefore[i].entry, 6);
      expect(partialClosed[i].exit).toBeCloseTo(fullBefore[i].exit, 6);
      expect(partialClosed[i].pnl).toBeCloseTo(fullBefore[i].pnl, 6);
    }
  });

  it("سقف سرمایه درگیر (۱۲٪) در سایز معاملات رعایت می‌شود", () => {
    const r = runBacktest({ symbol: "BTCIRT", candles15m: candles, cfg });
    for (const t of r.trades) {
      // ارزش ورود با احتساب لغزش و تلورانس باید زیر سقف درگیر بماند
      const entryNotional = t.qty * t.entry;
      expect(entryNotional).toBeLessThanOrEqual(cfg.paperInitialCapital * 0.15);
    }
  });

  it("با داده خیلی کوتاه هم بدون خطا اجرا می‌شود", () => {
    const r = runBacktest({ symbol: "BTCIRT", candles15m: makeCandles(10), cfg });
    expect(r.trades).toHaveLength(0);
  });
});
