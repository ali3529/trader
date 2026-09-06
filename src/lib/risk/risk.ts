import type { StrategyConfig } from "../config";
import type { EquityPoint, PerformanceMetrics, Position, Trade } from "../types";
import { gridAllocationCapital } from "../strategy/levels";
import type { GridInfo } from "../types";

export type RiskState = "normal" | "halved" | "stopped";

/** Drawdown جاری از سقف سرمایه به درصد */
export function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, ((peak - equity) / peak) * 100);
}

export function riskState(ddPct: number, cfg: StrategyConfig): RiskState {
  if (ddPct >= cfg.drawdownStopPct) return "stopped";
  if (ddPct >= cfg.drawdownHalvePct) return "halved";
  return "normal";
}

export interface SizingInput {
  equity: number;
  peakEquity: number;
  entry: number;
  stop: number;
  grid: GridInfo | null;
  openPositions: Position[];
  cfg: StrategyConfig;
}

export interface SizingResult {
  allowed: boolean;
  qty: number;
  notional: number;
  riskAmount: number;
  reason: string;
}

/**
 * سایز پوزیشن از فاصله ورود تا Stop و ریسک ۱٪ سرمایه،
 * با سقف سرمایه درگیر، سقف Grid و محدودیت‌های Drawdown.
 */
export function computePositionSize({
  equity,
  peakEquity,
  entry,
  stop,
  grid,
  openPositions,
  cfg,
}: SizingInput): SizingResult {
  const dd = drawdownPct(equity, peakEquity);
  const state = riskState(dd, cfg);

  if (state === "stopped") {
    return { allowed: false, qty: 0, notional: 0, riskAmount: 0, reason: `Drawdown ${dd.toFixed(1)}٪ از حد توقف (${cfg.drawdownStopPct}٪) عبور کرده — ورود جدید ممنوع` };
  }
  if (openPositions.length >= cfg.maxOpenPositions) {
    return { allowed: false, qty: 0, notional: 0, riskAmount: 0, reason: `سقف ${cfg.maxOpenPositions} پوزیشن هم‌زمان پر است` };
  }

  const stopDist = entry - stop;
  if (stopDist <= 0) {
    return { allowed: false, qty: 0, notional: 0, riskAmount: 0, reason: "Stop نامعتبر (بالای ورود)" };
  }

  const engaged = openPositions.reduce((a, p) => a + p.notional, 0);
  const engagedBudget = equity * (cfg.maxEngagedCapitalPct / 100);
  const remainingBudget = engagedBudget - engaged;
  if (remainingBudget <= 0) {
    return { allowed: false, qty: 0, notional: 0, riskAmount: 0, reason: `سقف سرمایه درگیر (${cfg.maxEngagedCapitalPct}٪) تکمیل است` };
  }

  let riskAmount = equity * (cfg.riskPerTradePct / 100);
  if (state === "halved") riskAmount /= 2;

  let qty = riskAmount / stopDist;
  const gridCap = gridAllocationCapital(equity, cfg, grid);
  const notionalCap = Math.min(remainingBudget, gridCap);
  if (qty * entry > notionalCap) qty = notionalCap / entry;

  const notional = qty * entry;
  if (notional < cfg.minOrderToman) {
    return { allowed: false, qty: 0, notional: 0, riskAmount: 0, reason: `سایز محاسبه‌شده کمتر از حداقل سفارش (${cfg.minOrderToman.toLocaleString("fa-IR")} تومان) است` };
  }
  return {
    allowed: true,
    qty,
    notional,
    riskAmount,
    reason: state === "halved" ? "سایز به دلیل Drawdown نصف شد" : "سایز استاندارد",
  };
}

/** ارزش به‌روز پوزیشن و PnL تحقق‌نیافته */
export function unrealizedPnl(p: Position, price: number): number {
  return (price - p.entry) * p.qty;
}

export function positionEquity(p: Position, price: number): number {
  return p.qty * price;
}

/**
 * مدیریت معامله روی هر کندل جدید:
 * RR=1.5 → Stop به ورود منتقل (Break Even) و Trailing با فاصله ۱.۲×ATR فعال،
 * RR=2.5 → بستن ۵۰٪ پوزیشن.
 * خروجی: دستورهای اجراشده + پوزیشن به‌روزشده.
 */
export interface ManageResult {
  position: Position | null; // null = پوزیشن کامل بسته شد
  partialClose: { qty: number; price: number; pnl: number } | null;
  stopHit: { price: number; reason: Trade["exitReason"] } | null;
  updated: boolean;
}

export function managePosition(p: Position, candle: { high: number; low: number; close: number }, atr: number, cfg: StrategyConfig): ManageResult {
  let updated = false;
  let stop = p.stop;
  let trailingActive = p.trailingActive;
  let breakEvenDone = p.breakEvenDone;
  let partialDone = p.partialDone;
  let qty = p.qty;
  const legs = p.legs.slice();
  let partialClose: ManageResult["partialClose"] = null;

  const stopDist0 = p.entry - p.initialStop;
  const riskPerUnit = stopDist0;

  // ۱) بررسی برخورد Stop (با کمترین قیمت کندل)
  if (candle.low <= stop) {
    const exitPrice = stop;
    const pnl = (exitPrice - p.entry) * qty;
    const reason: Trade["exitReason"] = !breakEvenDone ? "stop_loss" : trailingActive ? "trailing_stop" : "break_even_stop";
    return {
      position: null,
      partialClose: null,
      stopHit: { price: exitPrice, reason },
      updated: true,
    };
  }

  const favorable = candle.high - p.entry;
  const currentRR = riskPerUnit > 0 ? favorable / riskPerUnit : 0;

  // ۲) در RR=1.5: Break Even + فعال‌سازی Trailing
  if (!breakEvenDone && currentRR >= cfg.breakEvenRR) {
    stop = Math.max(stop, p.entry);
    breakEvenDone = true;
    trailingActive = true;
    updated = true;
  }

  // ۳) در RR=2.5: بستن جزئی ۵۰٪
  if (!partialDone && currentRR >= cfg.partialExitRR) {
    const closeQty = qty * cfg.partialExitFraction;
    const price = p.entry + riskPerUnit * cfg.partialExitRR;
    const pnl = (price - p.entry) * closeQty;
    qty -= closeQty;
    legs.push({ qty: closeQty, price, time: 0, reason: `خروج جزئی در RR=${cfg.partialExitRR}`, pnl });
    partialDone = true;
    partialClose = { qty: closeQty, price, pnl };
    updated = true;
  }

  // ۴) Trailing Stop با فاصله trailingAtrMult × ATR
  if (trailingActive && atr > 0) {
    const candidate = candle.close - cfg.trailingAtrMult * atr;
    if (candidate > stop) {
      stop = candidate;
      updated = true;
    }
  }

  const position: Position = {
    ...p,
    qty,
    stop,
    trailingActive,
    breakEvenDone,
    partialDone,
    legs,
    notional: qty * p.entry,
  };
  return { position: qty > 0 ? position : null, partialClose, stopHit: null, updated };
}

/** متریک‌های عملکرد از لیست معاملات بسته‌شده + منحنی سرمایه */
export function computeMetrics(trades: Trade[], equity: EquityPoint[], initialCapital: number): PerformanceMetrics {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);

  let peak = initialCapital;
  let maxDD = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
  }

  const tradeCount = trades.length;
  const winRate = tradeCount ? (wins.length / tradeCount) * 100 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = tradeCount ? totalPnl / tradeCount : 0;

  return {
    winRate,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDD,
    expectancy,
    totalPnl,
    totalPnlPct: initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0,
    avgHoldMs: tradeCount ? trades.reduce((a, t) => a + t.holdMs, 0) / tradeCount : 0,
    tradeCount,
    avgRR: tradeCount ? trades.reduce((a, t) => a + t.rrActual, 0) / tradeCount : 0,
  };
}
