import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import {
  computeMetrics,
  computePositionSize,
  drawdownPct,
  managePosition,
  riskState,
  unrealizedPnl,
} from "../risk/risk";
import type { EquityPoint, Position, Trade } from "../types";

const cfg = { ...DEFAULT_CONFIG };

function mockPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "BTCIRT-1",
    symbol: "BTCIRT",
    side: "buy",
    qty: 1,
    entry: 1000,
    stop: 900,
    initialStop: 900,
    target: 1250,
    rr: 2.5,
    openedAt: 0,
    atr: 10,
    trailingActive: false,
    breakEvenDone: false,
    partialDone: false,
    notional: 1000,
    legs: [],
    mode: "paper",
    signalScore: 7,
    ...overrides,
  };
}

describe("drawdownPct و riskState", () => {
  it("drawdown را از سقف سرمایه محاسبه می‌کند", () => {
    expect(drawdownPct(90, 100)).toBeCloseTo(10, 6);
    expect(drawdownPct(110, 100)).toBe(0); // سود drawdown نیست
    expect(drawdownPct(50, 0)).toBe(0);
  });

  it("در ۸٪ نصف و در ۱۲٪ توقف (پیش‌فرض)", () => {
    expect(riskState(5, cfg)).toBe("normal");
    expect(riskState(8, cfg)).toBe("halved");
    expect(riskState(11.9, cfg)).toBe("halved");
    expect(riskState(12, cfg)).toBe("stopped");
  });
});

describe("computePositionSize", () => {
  const base = { equity: 100_000_000, peakEquity: 100_000_000, grid: null, openPositions: [], cfg };

  it("ریسک ۱٪ سرمایه با سقف سهم هر پوزیشن محدود می‌شود", () => {
    // stopDist = 500 → qty خام = 1M/500 = 2000 (notional 2M زیر سقف 3M)
    const r = computePositionSize({ ...base, entry: 1000, stop: 500 });
    expect(r.allowed).toBe(true);
    expect(r.riskAmount).toBeCloseTo(1_000_000, 6);
    expect(r.qty).toBeCloseTo(2000, 6);
    expect(r.notional).toBeCloseTo(2_000_000, 6);
  });

  it("notional هرگز از سهم Grid/بودجه درگیر بیشتر نمی‌شود", () => {
    // stopDist کوچک → qty خام بزرگ؛ باید به 3M (= 12% سرمایه / 4 پوزیشن) محدود شود
    const r = computePositionSize({ ...base, entry: 1000, stop: 990 });
    expect(r.allowed).toBe(true);
    expect(r.notional).toBeCloseTo(3_000_000, 6);
    expect(r.qty).toBeCloseTo(3000, 6);
  });

  it("stop بالای ورود = ورود نامعتبر", () => {
    expect(computePositionSize({ ...base, entry: 1000, stop: 1010 }).allowed).toBe(false);
  });

  it("با Drawdown بیش از حد نصف، سایز نصف می‌شود", () => {
    const equity = 91_000_000; // dd = 9%
    const r = computePositionSize({ ...base, equity, peakEquity: 100_000_000, entry: 1000, stop: 500 });
    expect(r.allowed).toBe(true);
    expect(r.riskAmount).toBeCloseTo((equity * 0.01) / 2, 6);
    expect(r.qty).toBeCloseTo(r.riskAmount / 500, 6);
  });

  it("با Drawdown ۱۲٪ ورود کاملاً متوقف می‌شود", () => {
    const r = computePositionSize({ ...base, equity: 87_000_000, peakEquity: 100_000_000, entry: 1000, stop: 500 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("توقف");
  });

  it("سقف ۴ پوزیشن هم‌زمان رعایت می‌شود", () => {
    const open = Array.from({ length: 4 }, (_, i) => mockPosition({ id: `p${i}` }));
    const r = computePositionSize({ ...base, entry: 1000, stop: 500, openPositions: open });
    expect(r.allowed).toBe(false);
  });

  it("سقف سرمایه درگیر (۱۲٪) رعایت می‌شود", () => {
    const open = [mockPosition({ notional: 12_000_000 })];
    const r = computePositionSize({ ...base, entry: 1000, stop: 500, openPositions: open });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("درگیر");
  });
});

describe("managePosition", () => {
  it("برخورد Stop با low کندل، پوزیشن را کامل می‌بندد", () => {
    const r = managePosition(mockPosition(), { high: 1000, low: 890, close: 900 }, 10, cfg);
    expect(r.position).toBeNull();
    expect(r.stopHit).not.toBeNull();
    expect(r.stopHit!.price).toBe(900); // خروج روی خود Stop نه low
    expect(r.stopHit!.reason).toBe("stop_loss");
  });

  it("در RR=1.5 حد ضرر به ورود منتقل و Trailing فعال می‌شود", () => {
    const r = managePosition(mockPosition(), { high: 1160, low: 1050, close: 1150 }, 10, cfg);
    expect(r.position).not.toBeNull();
    expect(r.position!.breakEvenDone).toBe(true);
    expect(r.position!.trailingActive).toBe(true);
    // stop حداقل به ورود رسیده و trailing آن را بالاتر برده: close - 1.2×ATR
    expect(r.position!.stop).toBeCloseTo(1150 - 12, 6);
  });

  it("در RR=2.5 نیمی از پوزیشن با سود بسته می‌شود", () => {
    const r = managePosition(mockPosition({ qty: 2 }), { high: 1260, low: 1200, close: 1255 }, 10, cfg);
    expect(r.partialClose).not.toBeNull();
    expect(r.partialClose!.qty).toBeCloseTo(1, 6); // 50%
    expect(r.partialClose!.price).toBeCloseTo(1250, 6); // entry + 2.5R
    expect(r.partialClose!.pnl).toBeCloseTo(250, 6);
    expect(r.position!.qty).toBeCloseTo(1, 6);
    expect(r.position!.partialDone).toBe(true);
  });

  it("پس از Break Even، برخورد با stop جدید دلیل trailing/break_even می‌گیرد", () => {
    const p = mockPosition({ stop: 1000, breakEvenDone: true, trailingActive: true });
    const r = managePosition(p, { high: 1100, low: 999, close: 1050 }, 10, cfg);
    expect(r.stopHit).not.toBeNull();
    expect(r.stopHit!.reason).toBe("trailing_stop");
  });

  it("Trailing هرگز stop را پایین نمی‌آورد", () => {
    const p = mockPosition({ stop: 1140, breakEvenDone: true, trailingActive: true });
    const r = managePosition(p, { high: 1160, low: 1145, close: 1150 }, 10, cfg);
    expect(r.position!.stop).toBe(1140);
  });
});

describe("unrealizedPnl", () => {
  it("سود تحقق‌نیافته از قیمت جاری", () => {
    expect(unrealizedPnl(mockPosition({ qty: 2 }), 1100)).toBeCloseTo(200, 6);
  });
});

describe("computeMetrics", () => {
  const trade = (pnl: number, holdMs = 3_600_000, rrActual = 1): Trade => ({
    id: `t${pnl}`,
    symbol: "BTCIRT",
    openedAt: 0,
    closedAt: holdMs,
    entry: 1000,
    exit: 1000 + pnl,
    qty: 1,
    pnl,
    pnlPct: pnl / 10,
    fees: 5,
    rrPlanned: 2.5,
    rrActual,
    exitReason: pnl > 0 ? "partial_take_profit" : "stop_loss",
    entryReason: "—",
    mode: "paper",
    legs: [],
    holdMs,
  });

  it("نرخ برد، Profit Factor و میانگین‌ها را درست حساب می‌کند", () => {
    const trades = [trade(300), trade(-100), trade(100), trade(-50)];
    const equity: EquityPoint[] = [
      { time: 0, equity: 1000 },
      { time: 1, equity: 1300 },
      { time: 2, equity: 1200 },
      { time: 3, equity: 1300 },
      { time: 4, equity: 1250 },
    ];
    const m = computeMetrics(trades, equity, 1000);
    expect(m.tradeCount).toBe(4);
    expect(m.winRate).toBeCloseTo(50, 6);
    expect(m.totalPnl).toBeCloseTo(250, 6);
    expect(m.profitFactor).toBeCloseTo(400 / 150, 6);
    expect(m.expectancy).toBeCloseTo(62.5, 6);
    // max drawdown از 1300 به 1200 = 7.69%
    expect(m.maxDrawdownPct).toBeCloseTo((100 / 1300) * 100, 6);
  });

  it("بدون معامله همه صفر است", () => {
    const m = computeMetrics([], [], 1000);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.totalPnl).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
  });
});
