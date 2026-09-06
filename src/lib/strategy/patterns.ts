import type { Candle, PatternHit, PatternName } from "../types";

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}
function range(c: Candle): number {
  return c.high - c.low;
}
function isBullish(c: Candle): boolean {
  return c.close > c.open;
}
function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

/** Bullish Engulfing: کندل صعودی که بدنه کندل نزولی قبلی را کامل می‌پوشاند */
function bullishEngulfing(candles: Candle[], i: number): boolean {
  const a = candles[i - 1];
  const b = candles[i];
  return (
    isBearish(a) &&
    isBullish(b) &&
    b.close >= a.open &&
    b.open <= a.close &&
    body(b) > body(a)
  );
}

/** Pin Bar صعودی: سایه پایین بلند، بدنه کوچک در بالای کندل */
function bullishPinBar(candles: Candle[], i: number): boolean {
  const c = candles[i];
  const r = range(c);
  if (r <= 0) return false;
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  return lowerWick >= r * 0.6 && upperWick <= r * 0.15 && body(c) <= r * 0.35;
}

/** Hammer: بدنه کوچک نزدیک سقف، سایه پایین حداقل ۲ برابر بدنه، در کف محلی */
function hammer(candles: Candle[], i: number): boolean {
  const c = candles[i];
  const r = range(c);
  if (r <= 0 || body(c) === 0) return false;
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const localLow = Math.min(...candles.slice(Math.max(0, i - 5), i).map((x) => x.low));
  return lowerWick >= body(c) * 2 && upperWick <= body(c) && c.low <= localLow * 1.005;
}

/** Morning Star: نزولی بزرگ، بدنه کوچک جهش‌کرده، صعودی قوی */
function morningStar(candles: Candle[], i: number): boolean {
  if (i < 2) return false;
  const a = candles[i - 2];
  const b = candles[i - 1];
  const c = candles[i];
  return (
    isBearish(a) &&
    body(a) > range(a) * 0.5 &&
    body(b) < body(a) * 0.4 &&
    isBullish(c) &&
    c.close > a.open - (a.open - a.close) * 0.5
  );
}

/** Bearish Engulfing برای تأیید خروج */
function bearishEngulfing(candles: Candle[], i: number): boolean {
  const a = candles[i - 1];
  const b = candles[i];
  return (
    isBullish(a) &&
    isBearish(b) &&
    b.close <= a.open &&
    b.open >= a.close &&
    body(b) > body(a)
  );
}

/** Pin Bar نزولی برای تأیید خروج */
function bearishPinBar(candles: Candle[], i: number): boolean {
  const c = candles[i];
  const r = range(c);
  if (r <= 0) return false;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return upperWick >= r * 0.6 && lowerWick <= r * 0.15 && body(c) <= r * 0.35;
}

const DETECTORS: Record<PatternName, (candles: Candle[], i: number) => boolean> = {
  bullish_engulfing: bullishEngulfing,
  bullish_pinbar: bullishPinBar,
  hammer,
  morning_star: morningStar,
  bearish_engulfing: bearishEngulfing,
  bearish_pinbar: bearishPinBar,
};

export const PATTERN_LABELS: Record<PatternName, string> = {
  bullish_engulfing: "پوشای صعودی (Bullish Engulfing)",
  bullish_pinbar: "پین‌بار صعودی",
  hammer: "چکش (Hammer)",
  morning_star: "ستاره صبحگاهی (Morning Star)",
  bearish_engulfing: "پوشای نزولی (Bearish Engulfing)",
  bearish_pinbar: "پین‌بار نزولی",
};

const BULLISH_PATTERNS: PatternName[] = [
  "bullish_engulfing",
  "bullish_pinbar",
  "hammer",
  "morning_star",
];
const BEARISH_PATTERNS: PatternName[] = ["bearish_engulfing", "bearish_pinbar"];

/** الگوهای صعودی روی آخرین کندل بسته‌شده */
export function detectBullishPatterns(candles: Candle[]): PatternHit[] {
  const i = candles.length - 1;
  if (i < 3) return [];
  const hits: PatternHit[] = [];
  for (const name of BULLISH_PATTERNS) {
    if (DETECTORS[name](candles, i)) {
      hits.push({ name, index: i, bullish: true });
    }
  }
  return hits;
}

/** الگوهای نزولی روی آخرین کندل بسته‌شده */
export function detectBearishPatterns(candles: Candle[]): PatternHit[] {
  const i = candles.length - 1;
  if (i < 2) return [];
  const hits: PatternHit[] = [];
  for (const name of BEARISH_PATTERNS) {
    if (DETECTORS[name](candles, i)) {
      hits.push({ name, index: i, bullish: false });
    }
  }
  return hits;
}
