import type { StrategyConfig } from "../config";
import type { BacktestResult, Candle, Position, Trade, EquityPoint } from "../types";
import { aggregateCandles, lastAtr } from "../strategy/indicators";
import { analyzeStructure, hasRecentBearishChoch } from "../strategy/structure";
import { detectBearishPatterns } from "../strategy/patterns";
import { allLevels, nearestExitLevel } from "../strategy/levels";
import { evaluateEntry } from "../strategy/scoring";
import { computeMetrics, computePositionSize, managePosition } from "../risk/risk";

export interface BacktestOptions {
  symbol: string;
  candles15m: Candle[];
  cfg: StrategyConfig;
  initialCapital?: number;
  feePct?: number;
  slippagePct?: number;
}

/**
 * بک‌تست رویدادی بدون Look-ahead Bias:
 * - در هر لحظه فقط از کندل‌های بسته‌شده استفاده می‌شود (تجمیع تدریجی 15m→1h→4h)
 * - سیگنال فقط روی کندل ۱ ساعته تازه بسته‌شده ارزیابی می‌شود
 * - کارمزد، لغزش، خروج جزئی، Break Even، Trailing و Stop شبیه‌سازی می‌شوند
 */
export function runBacktest(opts: BacktestOptions): BacktestResult {
  const { symbol, candles15m, cfg } = opts;
  const initialCapital = opts.initialCapital ?? cfg.paperInitialCapital;
  const feePct = (opts.feePct ?? cfg.feePct) / 100;
  const slipPct = (opts.slippagePct ?? cfg.slippagePct) / 100;

  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  const bars1h: Candle[] = [];
  const bars4h: Candle[] = [];
  let cash = initialCapital;
  let peak = initialCapital;
  let position: Position | null = null;

  const markEquity = (time: number) => {
    const mv = position ? position.qty * candles15m[Math.min(i, candles15m.length - 1)].close : 0;
    const eq = cash + mv;
    peak = Math.max(peak, eq);
    equity.push({ time, equity: eq });
  };

  const closeTrade = (p: Position, exitPriceRaw: number, reason: Trade["exitReason"], time: number) => {
    const fill = exitPriceRaw * (1 - slipPct);
    const value = fill * p.qty;
    const fee = value * feePct;
    cash += value - fee;
    const partialPnl = p.legs.reduce((a, l) => a + l.pnl, 0);
    const finalPnl = (fill - p.entry) * p.qty - fee;
    const totalQty = p.qty + p.legs.reduce((a, l) => a + l.qty, 0);
    const entryNotional = totalQty * p.entry;
    const entryFee = entryNotional * feePct;
    const exitFees = p.legs.reduce((sum, leg) => sum + (leg.fee ?? 0), 0) + fee;
    const totalPnl = partialPnl + finalPnl - entryFee;
    const avgExit = totalQty > 0 ? (p.legs.reduce((a, l) => a + l.qty * l.price, 0) + fill * p.qty) / totalQty : fill;
    const riskPerUnit = p.entry - p.initialStop;
    trades.push({
      id: `${symbol}-bt-${p.openedAt}`,
      symbol,
      openedAt: p.openedAt,
      closedAt: time,
      entry: p.entry,
      exit: avgExit,
      qty: totalQty,
      pnl: totalPnl,
      pnlPct: entryNotional > 0 ? (totalPnl / entryNotional) * 100 : 0,
      fees: entryFee + exitFees,
      rrPlanned: p.rr,
      rrActual: riskPerUnit > 0 ? (avgExit - p.entry) / riskPerUnit : 0,
      exitReason: reason,
      entryReason: `سیگنال Price Action با امتیاز ${p.signalScore}/۸`,
      mode: "paper",
      legs: [...p.legs, { qty: p.qty, price: fill, time, reason, pnl: finalPnl, fee }],
      holdMs: Math.max(0, time - p.openedAt),
    });
    position = null;
  };

  let i = 0;
  for (; i < candles15m.length; i++) {
    const bar = candles15m[i];

    // تجمیع تدریجی: هر ۴ کندل ۱۵ دقیقه یک کندل ۱ ساعته بسته‌شده
    if ((i + 1) % 4 === 0) {
      const chunk = candles15m.slice(i - 3, i + 1);
      bars1h.push(aggregateCandles(chunk, 4)[0]);
      // هر ۴ کندل ۱ ساعته یک کندل ۴ ساعته بسته‌شده
      if (bars1h.length % 4 === 0) {
        bars4h.push(aggregateCandles(bars1h.slice(-4), 4)[0]);
      }
    }

    // مدیریت پوزیشن باز با همین کندل ۱۵ دقیقه بسته‌شده
    if (position && bars1h.length) {
      const atr1h = lastAtr(bars1h, cfg.atrPeriod) ?? position.atr;
      const res = managePosition(position, bar, atr1h, cfg);
      if (res.stopHit) {
        closeTrade(position, res.stopHit.price, res.stopHit.reason, bar.time);
      } else {
        if (res.partialClose) {
          const partialFill = res.partialClose.price * (1 - slipPct);
          const fee = res.partialClose.qty * partialFill * feePct;
          cash += res.partialClose.qty * partialFill - fee;
          if (res.position) {
            const legs = res.position.legs.slice(0, -1);
            legs.push({
              qty: res.partialClose.qty,
              price: partialFill,
              time: bar.time,
              reason: `خروج جزئی در RR=${cfg.partialExitRR}`,
              pnl: (partialFill - position.entry) * res.partialClose.qty - fee,
              fee,
            });
            res.position.legs = legs;
          }
        }
        if (res.position) position = res.position;
      }
    }

    // خروج با CHoCH نزولی ۴ ساعته (فقط روی کندل بسته‌شده)
    if (position && bars4h.length >= 20 && (i + 1) % 16 === 0) {
      const structure = analyzeStructure(bars4h, cfg.swingLookback);
      if (hasRecentBearishChoch(structure, cfg.exitChochBars)) {
        closeTrade(position, bar.close, "choch_down", bar.time);
      }
    }

    // ارزیابی سیگنال فقط روی کندل ۱ ساعته تازه بسته‌شده
    const isNewHour = (i + 1) % 4 === 0;
    if (isNewHour && bars1h.length >= 60 && bars4h.length >= 40 && !position) {
      const slice15 = candles15m.slice(Math.max(0, i - 159), i + 1);
      const signal = evaluateEntry({ symbol, candles4h: bars4h, candles1h: bars1h, candles15m: slice15, cfg });

      // خروج با تأیید نزولی روی مقاومت (اگر پوزیشن داشتیم بالا بررسی شد؛ برای پوزیشن باز)
      if (signal) {
        const sizing = computePositionSize({
          equity: cash + (position ? position.qty * bar.close : 0),
          peakEquity: peak,
          entry: signal.entry,
          stop: signal.stop,
          grid: signal.grid,
          openPositions: position ? [position] : [],
          cfg,
        });
        if (signal.qualified && sizing.allowed) {
          const fill = signal.entry * (1 + slipPct);
          const notional = sizing.qty * fill;
          const fee = notional * feePct;
          if (cash >= notional + fee) {
            cash -= notional + fee;
            position = {
              id: `${symbol}-bt-${bar.time}`,
              symbol,
              side: "buy",
              qty: sizing.qty,
              entry: fill,
              stop: signal.stop,
              initialStop: signal.stop,
              target: signal.target,
              rr: signal.rr,
              openedAt: bar.time,
              atr: signal.atr1h,
              trailingActive: false,
              breakEvenDone: false,
              partialDone: false,
              notional,
              legs: [],
              mode: "paper",
              signalScore: signal.score,
            };
          }
        }
      }
    }

    // خروج با تأیید نزولی روی مقاومت — کندل ۱ ساعته تازه بسته‌شده
    if (position && isNewHour && bars1h.length > 60) {
      const lastHour = bars1h[bars1h.length - 1];
      const atr1h = lastAtr(bars1h, cfg.atrPeriod) ?? position.atr;
      const levels = allLevels(bars1h, atr1h, cfg);
      const resistance = nearestExitLevel(levels, lastHour.close);
      const nearResistance = resistance && Math.abs(resistance.price - lastHour.close) <= cfg.levelProximityAtr * atr1h;
      if (nearResistance && detectBearishPatterns(bars1h, cfg).length) {
        closeTrade(position, lastHour.close, "bearish_confirmation", lastHour.time);
      }
    }

    // ثبت هر کندل بسته‌شده تا Max Drawdown میان‌روزی از دست نرود.
    markEquity(bar.time);
  }

  // بستن اجباری پوزیشن باز در انتهای دوره
  if (position && candles15m.length) {
    const lastCandle = candles15m[candles15m.length - 1];
    closeTrade(position, lastCandle.close, "final_close", lastCandle.time);
  }
  if (candles15m.length) markEquity(candles15m[candles15m.length - 1].time);

  return {
    trades,
    equity,
    metrics: computeMetrics(trades, equity, initialCapital),
    config: { initialCapital, feePct: feePct * 100, slippagePct: slipPct * 100 },
  };
}
