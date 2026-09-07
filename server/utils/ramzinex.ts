import { loadSecureState, saveSecureState } from "./nobitex";

/**
 * ادپتر رمزینکس — طبق مستندات رسمی docs.ramzinex.ir:
 * - عمومی:  https://publicapi.ramzinex.ir/exchange/api/v1.0/exchange
 * - خصوصی:  https://api.ramzinex.ir/exchange/api/v1.0/exchange (برخی endpointها v2.0)
 * - احراز: هدرهای `Authorization2: Bearer <token>` و `x-api-key: <api_key>`؛
 *   توکن از POST /auth/api_key/getToken با api_key+secret گرفته و تا نزدیکی exp کش می‌شود.
 * - وب‌سوکت Centrifugo جداست؛ در این ادپتر فقط REST پیاده‌سازی شده و اسکن روی کندل بسته می‌ماند.
 * قرارداد مبلغ: قیمت‌ها/موجودی ریال به واحد ریال فرض می‌شوند (تومان = ریال / ۱۰) مانند نوبیتکس.
 */

const PUBLIC_BASE = "https://publicapi.ramzinex.ir/exchange/api/v1.0/exchange";
const PRIVATE_BASE = "https://api.ramzinex.ir/exchange/api/v1.0/exchange";
const PRIVATE_V2_BASE = "https://api.ramzinex.ir/exchange/api/v2.0/exchange";
const KEYS_FILE = "ramzinex-keys.json";

export interface RamzinexKeys {
  apiKey: string;
  secret: string;
  realEnabled: boolean;
}

export function loadRamzinexKeys(): RamzinexKeys | null {
  return loadSecureState<RamzinexKeys | null>(KEYS_FILE, null);
}

export function saveRamzinexKeys(keys: RamzinexKeys): void {
  saveSecureState(KEYS_FILE, keys);
}

export class RamzinexError extends Error {
  statusCode: number;
  retryable: boolean;
  constructor(message: string, statusCode: number, retryable = false) {
    super(message);
    this.name = "RamzinexError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_INTERVAL_MS = 2_000;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function throttledFetch(input: string, init: RequestInit): Promise<Response> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return fetch(input, init);
  });
  queue = run.catch(() => undefined);
  return run;
}

let downUntil = 0;
const CIRCUIT_OPEN_MS = 60_000;

async function guardedFetch(input: string, init: RequestInit): Promise<Response> {
  if (Date.now() < downUntil) {
    throw new RamzinexError("رمزینکس موقتاً در دسترس نیست (قطع اتصال شبکه)", 503, true);
  }
  try {
    const res = await throttledFetch(input, init);
    downUntil = 0;
    return res;
  } catch (err) {
    if (err instanceof RamzinexError) throw err;
    downUntil = Date.now() + CIRCUIT_OPEN_MS;
    throw err;
  }
}

const errDetail = (err: unknown): string => {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message} [${cause}]` : e?.message ?? String(err);
};

interface RzEnvelope<T> {
  status?: number;
  data?: T;
  description?: string | null;
  message?: string;
}

export async function publicGet<T>(path: string, params: Record<string, string> = {}, base = PUBLIC_BASE): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await guardedFetch(url, {
        headers: { Accept: "application/json", "User-Agent": "TraderBot/Tradeban" },
        signal: AbortSignal.timeout(12_000),
      });
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        lastErr = new RamzinexError("rate limited", 429, true);
        if (attempt < 3) await sleep(5_000);
        continue;
      }
      if (!res.ok) throw new RamzinexError(`ramzinex ${res.status}: ${text.slice(0, 160)}`, res.status, res.status >= 500);
      const json = JSON.parse(text) as RzEnvelope<T>;
      if (json.status !== 0 && json.status !== undefined) {
        throw new RamzinexError(json.description ?? json.message ?? `ramzinex status ${json.status}`, res.status || 502);
      }
      return json.data as T;
    } catch (err) {
      console.log(`[ramzinex] GET ${url} -> FAILED | ${errDetail(err)}`);
      lastErr = err;
      if (err instanceof RamzinexError && (!err.retryable || err.statusCode === 503)) throw err;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ---------------------------------- توکن ---------------------------------- */

let tokenCache: { token: string; exp: number } | null = null;

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return Number(payload.exp) || Math.floor(Date.now() / 1000) + 1800;
  } catch {
    return Math.floor(Date.now() / 1000) + 1800;
  }
}

export async function getPrivateToken(force = false): Promise<string> {
  const keys = loadRamzinexKeys();
  if (!keys) throw new RamzinexError("کلید رمزینکس ذخیره نشده است", 400);
  if (!force && tokenCache && tokenCache.exp * 1000 - Date.now() > 60_000) return tokenCache.token;
  const res = await guardedFetch(`${PRIVATE_BASE}/auth/api_key/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: keys.apiKey, secret: keys.secret }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as RzEnvelope<{ token?: string }>;
  if (!res.ok || json.status !== 0 || !json.data?.token) {
    throw new RamzinexError(`دریافت توکن رمزینکس ناموفق (HTTP ${res.status})`, res.status || 502, res.status >= 500);
  }
  tokenCache = { token: json.data.token, exp: jwtExp(json.data.token) };
  return tokenCache.token;
}

export async function privateRequest<T>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; v2?: boolean; retryable?: boolean } = {},
): Promise<T> {
  const keys = loadRamzinexKeys();
  if (!keys) throw new RamzinexError("کلید رمزینکس ذخیره نشده است", 400);
  const base = opts.v2 ? PRIVATE_V2_BASE : PRIVATE_BASE;
  const qs = opts.query ? new URLSearchParams(opts.query).toString() : "";
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const canRetry = method === "GET" || opts.retryable === true;
  let refreshed = false;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const token = await getPrivateToken(refreshed);
    refreshed = false;
    try {
      const res = await guardedFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Authorization2": `Bearer ${token}`,
          "x-api-key": keys.apiKey,
        },
        body: method === "GET" ? undefined : bodyStr,
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json().catch(() => ({}))) as RzEnvelope<T>;
      if (res.status === 401 && !refreshed) {
        refreshed = true; // توکن منقضی/باطل — یک‌بار refresh اجباری و تلاش مجدد
        continue;
      }
      if (res.status === 429) {
        lastErr = new RamzinexError("rate limited", 429, true);
        if (canRetry && attempt < 3) await sleep(5_000);
        continue;
      }
      if (!res.ok || (json.status !== 0 && json.status !== undefined)) {
        throw new RamzinexError(
          json.description ?? json.message ?? `ramzinex ${res.status}: ${JSON.stringify(json).slice(0, 160)}`,
          res.status || 502,
          res.status >= 500,
        );
      }
      return json.data as T;
    } catch (err) {
      console.log(`[ramzinex] ${method} ${url} -> FAILED | ${errDetail(err)}`);
      lastErr = err;
      if (!canRetry || (err instanceof RamzinexError && (!err.retryable || err.statusCode === 503 || err.statusCode === 401))) throw err;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ------------------------------- بازارها (pairs) ------------------------------- */

export interface MarketInfo {
  id: number;
  symbol: string;
}

interface PairsCache {
  at: number;
  byNorm: Map<string, MarketInfo>;
  byId: Map<number, string>;
}

let pairsCache: PairsCache | null = null;
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function loadPairs(): Promise<PairsCache> {
  if (pairsCache && Date.now() - pairsCache.at < 10 * 60_000) return pairsCache;
  // پاسخ واقعی: { status:0, data:{ pairs:[...] } } — گاهی هم مستقیم آرایه
  const payload = await publicGet<{ pairs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
    "/pairs",
    {},
    PRIVATE_V2_BASE,
  );
  const pairs = Array.isArray(payload) ? payload : payload?.pairs ?? [];
  const byNorm = new Map<string, MarketInfo>();
  const byId = new Map<number, string>();
  for (const item of pairs ?? []) {
    const id = Number(item.id ?? item.pair_id);
    const symbol = String(item.symbol ?? item.name ?? item.pair ?? "");
    if (!Number.isInteger(id) || id <= 0 || !symbol) continue;
    byNorm.set(norm(symbol), { id, symbol });
    byId.set(id, norm(symbol));
  }
  if (!byNorm.size) throw new RamzinexError("فهرست بازارهای رمزینکس خالی است", 502);
  pairsCache = { at: Date.now(), byNorm, byId };
  return pairsCache;
}

/** نگاشت نماد تریدبان (BTCIRT) به بازار رمزینکس — با fallback پسوند IRT↔IRR */
export async function resolveMarket(symbol: string): Promise<MarketInfo> {
  const cache = await loadPairs();
  const base = norm(symbol);
  const candidates = [base, base.replace(/IRT$/, "IRR"), base.replace(/IRR$/, "IRT")];
  for (const candidate of candidates) {
    const hit = cache.byNorm.get(candidate);
    if (hit) return hit;
  }
  throw new RamzinexError(`بازار ${symbol} در رمزینکس پیدا نشد`, 404);
}

export function marketSymbolById(id: number): string | null {
  return pairsCache?.byId.get(id) ?? null;
}

/* -------------------------------- داده بازار -------------------------------- */

const ALLOWED_RESOLUTIONS = ["1", "5", "15", "30", "60", "120", "240", "720", "1D", "1W"] as const;

function ramzinexResolution(minutes: number): string {
  if (minutes >= 10_080) return "1W";
  if (minutes >= 1_440) return "1D";
  const numeric = ALLOWED_RESOLUTIONS.slice(0, 8).map(Number);
  const nearest = numeric.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best));
  return String(nearest);
}

export interface RzCandles {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

/** کندل‌ها: GET /chart/tv/history — خروجی UDF مانند نوبیتکس (زمان ثانیه یونیکس) */
export async function fetchCandles(symbol: string, minutes: number, fromSec: number, toSec: number): Promise<RzCandles> {
  const market = await resolveMarket(symbol);
  const data = await publicGet<Partial<RzCandles> & { s?: string }>("/chart/tv/history", {
    symbol: market.symbol,
    resolution: ramzinexResolution(minutes),
    from: String(Math.floor(fromSec)),
    to: String(Math.floor(toSec)),
  });
  if (data.s === "no_data") return { t: [], o: [], h: [], l: [], c: [], v: [] };
  if (!Array.isArray(data.t)) throw new RamzinexError("رمزینکس کندلی برنگرداند", 502);
  return {
    t: data.t.map(Number),
    o: (data.o ?? []).map(Number),
    h: (data.h ?? []).map(Number),
    l: (data.l ?? []).map(Number),
    c: (data.c ?? []).map(Number),
    v: (data.v ?? []).map(Number),
  };
}

/** دفتر سفارش‌ها: GET /orderbooks/{pair_id}/buys_sells — ردیف‌ها [قیمت, مقدار, ...] */
export async function fetchOrderBook(symbol: string): Promise<{ asks: number[][]; bids: number[][] }> {
  const market = await resolveMarket(symbol);
  const data = await publicGet<{ buys?: (string | number)[][]; sells?: (string | number)[][] }>(
    `/orderbooks/${market.id}/buys_sells`,
  );
  const toNums = (rows: (string | number)[][] | undefined) =>
    (rows ?? []).map((r) => [Number(r[0]), Number(r[1])]).filter((r) => isFinite(r[0]) && isFinite(r[1]));
  return { asks: toNums(data.sells), bids: toNums(data.buys) };
}

/* --------------------------------- حساب کاربر -------------------------------- */

export interface NormalizedAccount {
  balances: Record<string, number>;
  totalBalances: Record<string, number>;
  blockedBalances: Record<string, number>;
  openOrders: Array<Record<string, unknown>>;
}

const coinNorm = (raw: string): string => {
  const n = norm(raw);
  return n === "RIAL" ? "IRR" : n;
};

/** دارایی‌ها: GET /users/me/funds/summaryDesktop + سفارش‌های باز: POST /users/me/orders3 (states=1) */
export async function fetchAccount(): Promise<NormalizedAccount> {
  const funds = await privateRequest<Array<Record<string, unknown>>>("GET", "/users/me/funds/summaryDesktop");
  const balances: Record<string, number> = {};
  const totalBalances: Record<string, number> = {};
  const blockedBalances: Record<string, number> = {};
  for (const item of funds ?? []) {
    const rawSymbol = String(
      (item.currency as Record<string, unknown> | undefined)?.symbol ??
        (item.currency as Record<string, unknown> | undefined)?.name ??
        item.symbol ??
        item.currency_symbol ??
        "",
    );
    const coin = coinNorm(rawSymbol);
    if (!coin) continue;
    const inOrders = Number(item.in_orders_nr ?? item.in_orders ?? item.blocked ?? 0) || 0;
    const available = Number(item.available_nr ?? item.available ?? 0) || 0;
    const total = Number(item.total_nr ?? item.total ?? 0) || available + inOrders;
    if (available > 0) balances[coin] = available;
    if (total > 0) totalBalances[coin] = total;
    if (inOrders > 0) blockedBalances[coin] = inOrders;
  }
  const openOrders = await fetchOpenOrders();
  return { balances, totalBalances, blockedBalances, openOrders };
}

export interface RzOrder {
  id: number;
  pairId: number;
  symbol: string | null;
  side: "buy" | "sell";
  price: number;
  qty: number;
  filled: number;
  statusId: number;
  status: string;
  averagePrice: number;
  createdAtMs: number;
}

const STATUS_LABEL: Record<number, string> = { 1: "open", 2: "canceled", 3: "done", 4: "partial" };

function normalizeOrder(item: Record<string, unknown>): RzOrder {
  const pairId = Number(item.pair_id ?? 0);
  const statusId = Number(item.status_id ?? 1);
  return {
    id: Number(item.id ?? 0),
    pairId,
    symbol: marketSymbolById(pairId),
    side: String(item.type_en ?? item.type ?? "").toLowerCase() === "sell" ? "sell" : "buy",
    price: Number(item.order_price_nr ?? item.order_price ?? 0),
    qty: Number(item.amount_nr ?? item.amount ?? 0),
    filled: Number(item.filled_nr ?? 0),
    statusId,
    status: STATUS_LABEL[statusId] ?? "open",
    averagePrice: Number(item.average_price_nr ?? item.average_price ?? 0),
    createdAtMs: Number(item.created_at_ms ?? 0),
  };
}

/** سفارش‌های باز: POST /users/me/orders3 با states=1 */
export async function fetchOpenOrders(): Promise<Array<Record<string, unknown>>> {
  // طبق پاسخ واقعی سرور: states باید آرایه باشد
  const rows = await privateRequest<Array<Record<string, unknown>>>("POST", "/users/me/orders3", {
    body: { offset: 0, limit: 50, states: [1] },
  });
  return (rows ?? []).map((item) => ({ ...normalizeOrder(item as Record<string, unknown>) }));
}

/* ---------------------------------- سفارش‌ها ---------------------------------- */

export async function placeOrder(
  symbol: string,
  side: "buy" | "sell",
  execution: "limit" | "market",
  qty: number,
  priceToman: number,
): Promise<number> {
  const market = await resolveMarket(symbol);
  const priceRial = Math.round(priceToman * 10);
  if (execution === "limit") {
    const res = await privateRequest<{ order_id?: number }>("POST", "/users/me/orders/limit", {
      body: { pair_id: market.id, amount: qty, price: priceRial, type: side },
    });
    if (!res?.order_id) throw new RamzinexError("رمزینکس شناسه سفارش برنگرداند", 502);
    return Number(res.order_id);
  }
  const res = await privateRequest<{ order_id?: number }>("POST", "/users/me/orders/market", {
    body: { pair_id: market.id, amount: qty, type: side },
    v2: true,
  });
  if (!res?.order_id) throw new RamzinexError("رمزینکس شناسه سفارش برنگرداند", 502);
  return Number(res.order_id);
}

/** وضعیت سفارش: GET /users/me/orders2/{order_id} */
export async function orderStatus(orderId: number): Promise<RzOrder> {
  const data = await privateRequest<Record<string, unknown>>(`/users/me/orders2/${orderId}`);
  return normalizeOrder(data ?? {});
}

/** لغو سفارش: POST /users/me/orders/{order_id}/cancel */
export async function cancelOrder(orderId: number): Promise<void> {
  await privateRequest<unknown>("POST", `/users/me/orders/${orderId}/cancel`, { retryable: true });
}
