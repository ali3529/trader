import type { Candle, GridInfo, Level } from "../types";
import { swingPoints } from "./indicators";
import type { StrategyConfig } from "../config";

/**
 * شناسایی سطوح حمایت و مقاومت با کلاسترکردن نقاط چرخش نزدیک به هم.
 * قدرت سطح = تعداد برخوردها.
 */
export function supportResistance(candles: Candle[], atrValue: number, cfg?: StrategyConfig): Level[] {
  if (!atrValue || atrValue <= 0) return [];
  const swings = swingPoints(candles, cfg?.swingLookback ?? 2);
  const clusters: { price: number; count: number; time: number }[] = [];
  const tol = atrValue * (cfg?.levelClusterAtr ?? 0.5);

  for (const s of swings) {
    const hit = clusters.find((c) => Math.abs(c.price - s.price) <= tol);
    if (hit) {
      hit.price = (hit.price * hit.count + s.price) / (hit.count + 1);
      hit.count += 1;
      hit.time = candles[s.index].time;
    } else {
      clusters.push({ price: s.price, count: 1, time: candles[s.index].time });
    }
  }

  const last = candles[candles.length - 1];
  return clusters
    .filter((c) => c.count >= (cfg?.levelMinTouches ?? 2))
    .map((c) => ({
      price: c.price,
      kind: (c.price <= last.close ? "support" : "resistance") as Level["kind"],
      strength: Math.min(c.count, 5),
      time: c.time,
    }))
    .sort((a, b) => Math.abs(a.price - last.close) - Math.abs(b.price - last.close));
}

/**
 * Order Block ساده: آخرین کندل مخالف قبل از حرکت قوی در جهت روند
 * (حرکت قوی = بدنه‌ای بزرگ‌تر از ۱.۵ برابر میانگین بدنه ۲۰ دوره).
 */
export function orderBlocks(candles: Candle[], cfg?: StrategyConfig): Level[] {
  const bodyPeriod = cfg?.orderBlockBodyPeriod ?? 20;
  if (candles.length < bodyPeriod + 5) return [];
  const bodies = candles.slice(-bodyPeriod - 1, -1).map((c) => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  if (avgBody <= 0) return [];
  const out: Level[] = [];

  const lookback = cfg?.keyLevelLookbackBars ?? 40;
  for (let i = candles.length - 3; i >= Math.max(1, candles.length - lookback); i--) {
    const c = candles[i];
    const next = candles[i + 1];
    const strong = Math.abs(next.close - next.open) > avgBody * (cfg?.orderBlockImpulseMult ?? 1.5);
    if (!strong) continue;
    const bullishMove = next.close > next.open;
    const bearishCandle = c.close < c.open;
    if (bullishMove && bearishCandle) {
      out.push({ price: c.high, kind: "order_block", strength: 3, time: c.time });
    }
  }
  return out.slice(0, cfg?.maxKeyLevels ?? 5);
}

/** FVG سه‌کندلی: شکاف بین high کندل اول و low کندل سوم در حرکت صعودی */
export function fairValueGaps(candles: Candle[], cfg?: StrategyConfig): Level[] {
  const out: Level[] = [];
  const lookback = cfg?.keyLevelLookbackBars ?? 40;
  for (let i = candles.length - 3; i >= Math.max(0, candles.length - lookback); i--) {
    const a = candles[i];
    const b = candles[i + 1];
    const c = candles[i + 2];
    const strong = b.close > b.open && Math.abs(b.close - b.open) > Math.abs(a.close - a.open) * (cfg?.fvgImpulseBodyRatio ?? 1);
    if (strong && c.low > a.high) {
      out.push({
        price: (a.high + c.low) / 2,
        kind: "fvg",
        strength: 2,
        time: b.time,
      });
    }
  }
  return out.slice(0, cfg?.maxKeyLevels ?? 5);
}

export function allLevels(candles: Candle[], atrValue: number, cfg?: StrategyConfig): Level[] {
  return [...supportResistance(candles, atrValue, cfg), ...orderBlocks(candles, cfg), ...fairValueGaps(candles, cfg)];
}

/** نزدیک‌ترین سطح معتبر زیر قیمت (برای Stop و محل ورود) */
export function nearestSupport(levels: Level[], price: number): Level | null {
  const below = levels
    .filter((l) => l.kind === "support" || l.kind === "order_block" || l.kind === "fvg")
    .filter((l) => l.price < price)
    .sort((a, b) => b.price - a.price);
  return below[0] ?? null;
}

/** نزدیک‌ترین مقاومت بالای قیمت (برای هدف) */
export function nearestResistance(levels: Level[], price: number): Level | null {
  const above = levels
    .filter((l) => l.kind === "resistance")
    .filter((l) => l.price > price)
    .sort((a, b) => a.price - b.price);
  return above[0] ?? null;
}

/** نزدیک‌ترین مانع عرضه بالای قیمت: مقاومت، Order Block یا FVG. */
export function nearestExitLevel(levels: Level[], price: number): Level | null {
  const above = levels
    .filter((level) => level.price > price)
    .sort((a, b) => a.price - b.price || b.strength - a.strength);
  return above[0] ?? null;
}

/**
 * Grid: تقسیم فاصله حمایت تا مقاومت اصلی ۳۰ روز اخیر به ۲۵ سطح.
 * فقط برای تقسیم سرمایه و محدودکردن سایز — هرگز سیگنال ورود نیست.
 * اگر فاصله کمتر از gridMinRangePct باشد Grid غیرفعال می‌شود.
 */
export function buildGrid(
  candles1h: Candle[],
  cfg: StrategyConfig,
  atrValue: number
): GridInfo {
  const windowMs = cfg.gridLookbackDays * 24 * 3600 * 1000;
  const cutoff = candles1h[candles1h.length - 1].time - windowMs;
  const recent = candles1h.filter((c) => c.time >= cutoff);
  if (recent.length < 30 || !atrValue) {
    return { enabled: false, support: 0, resistance: 0, levels: [], rangePct: 0 };
  }

  const levels = supportResistance(recent, atrValue, cfg);
  const lastPrice = recent[recent.length - 1].close;
  const supports = levels.filter((l) => l.price < lastPrice).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.price > lastPrice).sort((a, b) => a.price - b.price);
  const support = supports.length ? supports[supports.length - 1].price : Math.min(...recent.map((c) => c.low));
  const resistance = resistances.length ? resistances[resistances.length - 1].price : Math.max(...recent.map((c) => c.high));

  const rangePct = ((resistance - support) / support) * 100;
  if (!isFinite(rangePct) || rangePct < cfg.gridMinRangePct || resistance <= support) {
    return { enabled: false, support, resistance, levels: [], rangePct };
  }

  const count = Math.max(2, Math.round(cfg.gridLevels));
  const gridLevels: number[] = [];
  for (let i = 0; i < count; i++) {
    gridLevels.push(support + ((resistance - support) * i) / (count - 1));
  }
  return { enabled: true, support, resistance, levels: gridLevels, rangePct };
}

/**
 * سهم سرمایه هر ورود بر اساس Grid:
 * سرمایه درگیر مجاز بین ناحیه‌های Grid تقسیم می‌شود تا سایز هر معامله محدود بماند.
 */
export function gridAllocationCapital(
  equity: number,
  cfg: StrategyConfig,
  grid: GridInfo | null
): number {
  const engagedBudget = equity * (cfg.maxEngagedCapitalPct / 100);
  const perPosition = engagedBudget / cfg.maxOpenPositions;
  if (!grid || !grid.enabled) return perPosition;
  return Math.min(perPosition, engagedBudget / cfg.gridZones);
}
