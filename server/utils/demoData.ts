/**
 * داده شبیه‌سازی‌شدهٔ قطعی (Deterministic) — فقط وقتی نوبیتکس در دسترس نیست
 * (مثلاً محیط پیش‌نمایش که شبکه خروجی به apiv2.nobitex.ir ندارد).
 * همهٔ پاسخ‌ها با source:"demo" برچسب می‌خورند تا UI هشدار واضح نشان دهد.
 * این داده هرگز برای معامله واقعی استفاده نمی‌شود (گیت ENABLE-REAL-TRADING سر جای خود است).
 */

/** قیمت پایهٔ تقریبی نمادها به ریال — فقط برای باورپذیری مقیاس اعداد */
const BASE_PRICES: Record<string, number> = {
  BTCIRT: 115_000_000_000,
  ETHIRT: 4_300_000_000,
  BNBIRT: 700_000_000,
  LTCIRT: 120_000_000,
  XRPIRT: 3_100_000,
  TONIRT: 5_800_000,
  USDTIRT: 1_050_000,
  ADAIRT: 900_000,
  TRXIRT: 285_000,
  DOGEIRT: 250_000,
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — یک گام، خروجی [0,1) */
function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const noise = (key: string) => rand01(hashStr(key));
const round = (n: number) => Math.round(n * 100) / 100;

/** قیمت پای کندل شماره i — قطعی و مستقل از بازهٔ درخواست (بدون look-ahead) */
function priceAt(symbol: string, resolutionSec: number, i: number): number {
  const base = BASE_PRICES[symbol] ?? 1_000_000;
  const ph = noise(symbol) * Math.PI * 2;
  const wave =
    0.045 * Math.sin(i / 21 + ph) +
    0.02 * Math.sin(i / 6.7 + ph * 2) +
    0.008 * Math.sin(i / 2.3 + ph * 3);
  const drift = 0.00012 * Math.sin(i / 340 + ph);
  const jitter = (noise(`${symbol}:${resolutionSec}:${i}`) - 0.5) * 0.012;
  return base * (1 + wave + drift + jitter);
}

export interface DemoCandles {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  source: "demo";
}

/** کندل‌های شبیه‌سازی‌شده؛ ورودی/خروجی زمان در میلی‌ثانیه (هم‌راستا با پروکسی) */
export function demoCandles(symbol: string, resolutionSec: number, fromMs: number, toMs: number): DemoCandles {
  const fromSec = Math.floor(fromMs / 1000);
  const toSec = Math.floor(toMs / 1000);
  const nowIdx = Math.floor(Date.now() / 1000 / resolutionSec);
  let start = Math.floor(fromSec / resolutionSec);
  const end = Math.min(Math.floor(toSec / resolutionSec), nowIdx);
  const MAX = 1200;
  if (end - start + 1 > MAX) start = end - MAX + 1;

  const out: DemoCandles = { time: [], open: [], high: [], low: [], close: [], volume: [], source: "demo" };
  for (let i = start; i <= end; i++) {
    const open = priceAt(symbol, resolutionSec, i - 1);
    let close = priceAt(symbol, resolutionSec, i);
    // کندل جاری (بسته‌نشده) با زمان جلو می‌رود تا_chart و ربات بازار زنده ببینند
    if (i === nowIdx) {
      const tick = Math.floor(Date.now() / 15000);
      close *= 1 + (noise(`${symbol}:tick:${tick}`) - 0.5) * 0.004;
    }
    const wick = 0.004 + noise(`${symbol}:w:${i}`) * 0.006;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - wick);
    const volume = Math.round((50 + noise(`${symbol}:v:${i}`) * 400) * 1000) / 1000;
    out.time.push(i * resolutionSec * 1000);
    out.open.push(round(open));
    out.high.push(round(high));
    out.low.push(round(low));
    out.close.push(round(close));
    out.volume.push(volume);
  }
  return out;
}

export function demoLastPrice(symbol: string, resolutionSec = 60): number {
  const i = Math.floor(Date.now() / 1000 / resolutionSec);
  return priceAt(symbol, resolutionSec, i);
}

export interface DemoOrderBook {
  asks: number[][];
  bids: number[][];
  source: "demo";
}

export function demoOrderBook(symbol: string): DemoOrderBook {
  const last = demoLastPrice(symbol);
  const spread = last * 0.0002;
  const bucket = Math.floor(Date.now() / 30000);
  const asks: number[][] = [];
  const bids: number[][] = [];
  for (let k = 1; k <= 12; k++) {
    asks.push([round(last + spread * k), round(0.2 + noise(`${symbol}:aq:${k}:${bucket}`) * 3)]);
    bids.push([round(last - spread * k), round(0.2 + noise(`${symbol}:bq:${k}:${bucket}`) * 3)]);
  }
  return { asks, bids, source: "demo" };
}
