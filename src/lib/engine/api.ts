import type { StrategyConfig } from "../config";
import type { ApiLogEntry, Candle } from "../types";

type Listener = (log: ApiLogEntry) => void;

const listeners = new Set<Listener>();
const logs: ApiLogEntry[] = [];
const MAX_LOGS = 500;

export function onApiLog(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getApiLogs(): ApiLogEntry[] {
  return logs.slice();
}

function log(entry: ApiLogEntry): void {
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  listeners.forEach((fn) => fn(entry));
}

/** صف جهانی درخواست‌ها — حداقل فاصله بین دو درخواست API رعایت می‌شود */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

let minIntervalMs = 12_000;
let maxRetries = 3;
let retryDelayMs = 30_000;

export function configureApi(cfg: StrategyConfig): void {
  minIntervalMs = cfg.apiMinIntervalMs;
  maxRetries = cfg.apiMaxRetries;
  retryDelayMs = cfg.apiRetryDelayMs;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimitError extends Error {}

/**
 * درخواست GET به API سرور با Rate Limit:
 * حداکثر ۳ تلاش مجدد با ۳۰ ثانیه مکث؛ همه چیز لاگ می‌شود.
 */
export function apiGet<T>(path: string, retryWait = true): Promise<T> {
  return enqueue(async () => {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const started = Date.now();
      try {
        const res = await fetch(path);
        const latencyMs = Date.now() - started;
        if (res.status === 429) throw new RateLimitError("rate limited");
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          log({ time: Date.now(), endpoint: path, status: "error", attempt, latencyMs, detail: `HTTP ${res.status} ${text.slice(0, 120)}` });
          throw new Error(`API error ${res.status}: ${text.slice(0, 120)}`);
        }
        const data = (await res.json()) as T;
        log({ time: Date.now(), endpoint: path, status: "ok", attempt, latencyMs, detail: "—" });
        return data;
      } catch (err) {
        const latencyMs = Date.now() - started;
        const rateLimited = err instanceof RateLimitError;
        if (attempt <= maxRetries) {
          log({
            time: Date.now(),
            endpoint: path,
            status: "retry",
            attempt,
            latencyMs,
            detail: rateLimited ? `Rate Limit — تلاش مجدد ${attempt}/${maxRetries} پس از ${Math.round(retryDelayMs / 1000)} ثانیه` : `خطا: ${(err as Error).message}`,
          });
          await sleep(rateLimited && retryWait ? retryDelayMs : Math.min(retryDelayMs, 3000 * attempt));
          continue;
        }
        log({ time: Date.now(), endpoint: path, status: "error", attempt, latencyMs, detail: (err as Error).message });
        throw err;
      }
    }
  });
}

interface NobitexCandleResponse {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  source?: "live" | "demo";
}

/** منبع دادهٔ بازار: live = نوبیتکس واقعی، demo = شبیه‌سازی‌شده (نوبیتکس در دسترس نیست) */
export type DataSource = "live" | "demo" | "unknown";

let dataSource: DataSource = "unknown";
const dsListeners = new Set<(s: DataSource) => void>();

export function getDataSource(): DataSource {
  return dataSource;
}

export function onDataSource(fn: (s: DataSource) => void): () => void {
  dsListeners.add(fn);
  return () => dsListeners.delete(fn);
}

function setDataSource(s: DataSource): void {
  if (s === dataSource) return;
  dataSource = s;
  dsListeners.forEach((fn) => fn(s));
}

function trackSource(source?: "live" | "demo"): void {
  setDataSource(source === "demo" ? "demo" : "live");
}

interface RawCandleArrays {
  time?: number[];
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
}

const toCandles = (d: RawCandleArrays, timeInMs: boolean): Candle[] => {
  const out: Candle[] = (d.time ?? []).map((t, i) => ({
    time: timeInMs ? t : t * 1000,
    open: d.open?.[i] ?? 0,
    high: d.high?.[i] ?? 0,
    low: d.low?.[i] ?? 0,
    close: d.close?.[i] ?? 0,
    volume: d.volume?.[i] ?? 0,
  }));
  return out.sort((a, b) => a.time - b.time);
};

/**
 * تلاش مستقیم مرورگر → API عمومی نوبیتکس (بدون کلید؛ فقط endpointهای عمومی).
 * چرا؟ سرور پیش‌نمایش به دامنهٔ نوبیتکس دسترسی ندارد ولی مرورگر کاربر ممکن است داشته باشد؛
 * پس تاریخچهٔ واقعی هم‌منبع با وب‌سوکت می‌شود. اگر CORS/شبکه اجازه نداد، فقط یک‌بار
 * لاگ می‌شود و بقیهٔ جلسه از پروکسی سرور استفاده می‌شود. کلیدها هرگز در فرانت‌اند نیستند.
 */
const DIRECT_BASES = ["https://apiv2.nobitex.ir", "https://api.nobitex.ir"];
let directBaseIndex: number | null = null;
let directRestWorks: boolean | null = null;

/**
 * api.nobitex.ir از DNS حذف شده (ERR_NAME_NOT_RESOLVED)؛ پس اول apiv2 تلاش می‌شود.
 * پایهٔ موفق برای بقیهٔ جلسه به خاطر سپرده می‌شود.
 */
async function tryDirectJson<T>(buildUrl: (base: string) => string): Promise<T | null> {
  if (directRestWorks === false) return null;
  const order =
    directBaseIndex === null ? [0, 1] : [directBaseIndex, 1 - directBaseIndex];
  for (const index of order) {
    try {
      const res = await fetch(buildUrl(DIRECT_BASES[index]), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      directBaseIndex = index;
      directRestWorks = true;
      return (await res.json()) as T;
    } catch {
      // خطای DNS/CORS روی این پایه — پایهٔ بعدی تلاش می‌شود
    }
  }
  directRestWorks = false;
  console.info(
    "[nobitex-rest] direct browser→Nobitex blocked (CORS or network) — falling back to server proxy."
  );
  return null;
}

interface UdfHistory {
  s?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

/** رزولوشن UDF برحسب دقیقه است؛ فراخوان ممکن است ثانیه (3600) یا دقیقه (60) بفرستد. */
function udfResolution(resolution: string): string {
  const value = Number(resolution);
  const minutes = value >= 60 ? value / 60 : value;
  const allowed = [15, 60, 240];
  const nearest = allowed.reduce((best, m) =>
    Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best
  );
  return String(nearest);
}

const toNums = (rows: (string | number)[][] | undefined) =>
  (rows ?? []).map((r) => [Number(r[0]), Number(r[1])]);

/** دریافت کندل‌ها: اول مستقیم از نوبیتکس (مرورگر)، در نبود آن پروکسی سرور */
export async function fetchCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<Candle[]> {
  const direct = await enqueue(() =>
    tryDirectJson<UdfHistory | RawCandleArrays[] | RawCandleArrays>((base) =>
      `${base}/market/udf/history?symbol=${encodeURIComponent(symbol)}&resolution=${udfResolution(resolution)}&from=${Math.floor(from / 1000)}&to=${Math.floor(to / 1000)}`
    )
  );
  if (direct) {
    trackSource("live");
    let d: RawCandleArrays;
    if (Array.isArray(direct)) {
      d = direct[0] ?? {};
    } else {
      const udf = direct as UdfHistory;
      d = udf.t
        ? { time: udf.t, open: udf.o, high: udf.h, low: udf.l, close: udf.c, volume: udf.v }
        : (direct as RawCandleArrays);
    }
    return toCandles(d, false);
  }
  const qs = new URLSearchParams({ symbol, resolution, from: String(from), to: String(to) });
  const data = await apiGet<NobitexCandleResponse>(`/api/market/candles?${qs}`);
  trackSource(data.source);
  return toCandles(data, true);
}

/** دفتر سفارش‌ها: اول مستقیم (v3)، در نبود آن پروکسی سرور */
export async function fetchOrderBook(symbol: string): Promise<{ asks: number[][]; bids: number[][] }> {
  const direct = await enqueue(() =>
    tryDirectJson<{ asks?: (string | number)[][]; bids?: (string | number)[][] }>(
      (base) => `${base}/v3/orderbook/${encodeURIComponent(symbol)}`
    )
  );
  if (direct) {
    trackSource("live");
    return { asks: toNums(direct.asks), bids: toNums(direct.bids) };
  }
  const data = await apiGet<{ asks: number[][]; bids: number[][]; source?: "live" | "demo" }>(
    `/api/market/orderbook?symbol=${encodeURIComponent(symbol)}`
  );
  trackSource(data.source);
  return { asks: data.asks, bids: data.bids };
}
