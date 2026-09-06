import type { Candle } from "../types";

/** RSI با روش وایلدر — فقط روی داده موجود محاسبه می‌شود (بدون look-ahead) */
export function rsi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function lastRsi(candles: Candle[], period = 14): number | null {
  const series = rsi(candles, period);
  return series[series.length - 1] ?? null;
}

/** ATR با روش وایلدر */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length < period + 1) return out;
  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let prev = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function lastAtr(candles: Candle[], period = 14): number | null {
  const series = atr(candles, period);
  return series[series.length - 1] ?? null;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** نسبت حجم آخرین کندل بسته‌شده به میانگین N دوره قبل از آن */
export function volumeRatio(candles: Candle[], period = 10): number | null {
  if (candles.length < period + 1) return null;
  const prev = candles.slice(-period - 1, -1).map((c) => c.volume);
  const avg = prev.reduce((a, b) => a + b, 0) / period;
  if (avg <= 0) return null;
  return candles[candles.length - 1].volume / avg;
}

export interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

/**
 * نقاط چرخش (Swing) با تایید `lookback` کندل در دو طرف.
 * آخرین swing فقط زمانی برگردانده می‌شود که کندل‌های کافی بعد از آن بسته شده باشند
 * (جلوگیری از look-ahead bias).
 */
export function swingPoints(candles: Candle[], lookback = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: c.high, type: "high" });
    if (isLow) swings.push({ index: i, price: c.low, type: "low" });
  }
  return swings;
}

/** تجمیع کندل‌های تایم‌فریم پایین به بالاتر — فقط کندل‌های کامل */
export function aggregateCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles.slice();
  const out: Candle[] = [];
  const full = candles.length - (candles.length % factor);
  for (let i = 0; i < full; i += factor) {
    const chunk = candles.slice(i, i + factor);
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((a, c) => a + c.volume, 0),
    });
  }
  return out;
}
