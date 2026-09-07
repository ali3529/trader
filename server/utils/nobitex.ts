import { createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createError } from "nitro/h3";

/**
 * لایه امن نوبیتکس — فقط سمت سرور.
 * کلیدهای API با AES-256-GCM رمزنگاری‌شده روی دیسک نگهداری می‌شوند
 * و هرگز به فرانت‌اند یا لاگ‌ها برنمی‌گردند.
 */

export interface StoredKeys {
  apiKey: string;
  apiSecret: string;
  sandbox: boolean;
  realEnabled: boolean;
}

// api.nobitex.ir was retired from DNS. The current public and API-key
// endpoints are served from apiv2.nobitex.ir.
const BASE_URL = "https://apiv2.nobitex.ir";
const SANDBOX_URL = "https://testnetapi.nobitex.ir";
const DATA_DIR = join(process.cwd(), ".tradeban");
const KEYS_FILE = join(DATA_DIR, "keys.enc.json");
const MASTER_FILE = join(DATA_DIR, "master.key");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000;
const MIN_UPSTREAM_INTERVAL_MS = Math.max(
  12_000,
  Number(process.env.TRADEBAN_NOBITEX_INTERVAL_MS) || 12_000,
);

let upstreamQueue: Promise<unknown> = Promise.resolve();
let lastUpstreamRequestAt = 0;

export class NobitexRequestError extends Error {
  statusCode: number;
  retryable: boolean;

  constructor(message: string, statusCode: number, retryable = false) {
    super(message);
    this.name = "NobitexRequestError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

/** کلید رمزنگاری: از TRADEBAN_SECRET یا یک کلید تصادفی محلی (فایل با مجوز 600) */
function masterSecret(): string {
  const envSecret = process.env.TRADEBAN_SECRET;
  if (envSecret) return envSecret;
  ensureDir();
  if (!existsSync(MASTER_FILE)) {
    writeFileSync(MASTER_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
    chmodSync(MASTER_FILE, 0o600);
  }
  return readFileSync(MASTER_FILE, "utf8");
}

function deriveKey(): Buffer {
  return createHash("sha256").update(masterSecret()).digest();
}

function encryptJson(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString("hex"), tag: tag.toString("hex"), data: enc.toString("hex") });
}

function decryptJson<T>(payload: string): T {
  const { iv, tag, data } = JSON.parse(payload) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}

export function loadKeys(): StoredKeys | null {
  try {
    if (!existsSync(KEYS_FILE)) return null;
    return decryptJson<StoredKeys>(readFileSync(KEYS_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function saveKeys(keys: StoredKeys): void {
  ensureDir();
  writeFileSync(KEYS_FILE, encryptJson(keys), { mode: 0o600 });
  chmodSync(KEYS_FILE, 0o600);
}

export function deleteKeys(): void {
  if (existsSync(KEYS_FILE)) unlinkSync(KEYS_FILE);
}

/** ذخیره state حساس داخلی با همان AES-256-GCM و نوشتن اتمیک. */
export function saveSecureState(name: string, value: unknown): void {
  if (!/^[a-z0-9.-]{1,80}$/i.test(name)) throw new Error("نام state امن نامعتبر است");
  ensureDir();
  const target = join(DATA_DIR, name);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, encryptJson(value), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
}

export function loadSecureState<T>(name: string, fallback: T): T {
  if (!/^[a-z0-9.-]{1,80}$/i.test(name)) throw new Error("نام state امن نامعتبر است");
  try {
    const target = join(DATA_DIR, name);
    if (!existsSync(target)) return fallback;
    return decryptJson<T>(readFileSync(target, "utf8"));
  } catch {
    return fallback;
  }
}

export function baseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_URL : BASE_URL;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A single server-wide queue prevents private routes from bypassing the 12s spacing. */
function throttledFetch(input: string, init: RequestInit): Promise<Response> {
  const run = upstreamQueue.then(async () => {
    const wait = Math.max(0, lastUpstreamRequestAt + MIN_UPSTREAM_INTERVAL_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastUpstreamRequestAt = Date.now();
    return fetch(input, init);
  });
  upstreamQueue = run.catch(() => undefined);
  return run;
}

let upstreamDownUntil = 0;
const CIRCUIT_OPEN_MS = 60_000;

/** آیا بالادست در دسترس است؟ پس از خطای شبکه، تا ۶۰ ثانیه درخواست‌ها سریع شکست می‌خورند. */
export function upstreamHealthy(): boolean {
  return Date.now() >= upstreamDownUntil;
}

/**
 * Circuit breaker: وقتی نوبیتکس غیرقابل دسترس است (DNS/timeout)، صف سراسری نباید
 * هر درخواست را ۱۲ ثانیه نگه دارد؛ اولین شکست شبکه مدار را ۶۰ ثانیه باز می‌کند.
 */
let probeInFlight: Promise<Response> | null = null;
let lastProbeAt = 0;
const PROBE_INTERVAL_MS = 20_000;

async function guardedFetch(input: string, init: RequestInit): Promise<Response> {
  if (!upstreamHealthy()) {
    // مدار نیمه‌باز: فقط GETها هر ۲۰ ثانیه یک پروب واقعی می‌فرستند تا بازیابی
    // اتصال زودتر از پایان پنجرهٔ ۶۰ ثانیه‌ای کشف شود؛ بقیهٔ درخواست‌ها سریع شکست می‌خورند.
    const probeAllowed = (init.method ?? "GET") === "GET";
    if (probeAllowed && !probeInFlight && Date.now() - lastProbeAt >= PROBE_INTERVAL_MS) {
      lastProbeAt = Date.now();
      probeInFlight = throttledFetch(input, init)
        .then((res) => {
          upstreamDownUntil = 0;
          return res;
        })
        .catch((err) => {
          upstreamDownUntil = Date.now() + CIRCUIT_OPEN_MS;
          throw err;
        })
        .finally(() => {
          probeInFlight = null;
        });
      return probeInFlight;
    }
    throw new NobitexRequestError("Nobitex upstream unreachable (circuit breaker open)", 503, true);
  }
  try {
    const res = await throttledFetch(input, init);
    upstreamDownUntil = 0;
    return res;
  } catch (err) {
    if (err instanceof NobitexRequestError) throw err;
    upstreamDownUntil = Date.now() + CIRCUIT_OPEN_MS;
    throw err;
  }
}

const errDetail = (err: unknown): string => {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message} [${cause}]` : e?.message ?? String(err);
};

/** درخواست عمومی با Rate Limit: حداکثر ۳ تلاش مجدد با ۳۰ ثانیه مکث */
export async function publicGet(path: string, params: Record<string, string>, sandbox = false): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl(sandbox)}${path}${qs ? `?${qs}` : ""}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    try {
      const res = await guardedFetch(url, {
        headers: { Accept: "application/json", "User-Agent": "TraderBot/Tradeban" },
        signal: AbortSignal.timeout(12_000),
      });
      const latency = Date.now() - started;
      const text = await res.text().catch(() => "");
      console.log(`[nobitex] GET ${url} -> HTTP ${res.status} in ${latency}ms | body: ${text.slice(0, 200)}`);
      if (res.status === 429) {
        lastErr = new Error("rate limited");
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!res.ok) {
        throw new NobitexRequestError(`nobitex ${res.status}: ${text.slice(0, 200)}`, res.status, res.status >= 500);
      }
      return JSON.parse(text);
    } catch (err) {
      console.log(`[nobitex] GET ${url} -> FAILED in ${Date.now() - started}ms | ${errDetail(err)}`);
      lastErr = err;
      if (err instanceof NobitexRequestError && err.statusCode === 503) throw toHttpError(err);
      // مکث ۳۰ ثانیه‌ای فقط برای Rate Limit (429)؛ خطاهای شبکه با مکث کوتاه تلاش مجدد می‌شوند
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw toHttpError(lastErr);
}

/**
 * درخواست خصوصی نوبیتکس با امضای Ed25519 طبق API Key v2:
 * headers: Nobitex-Key, Nobitex-Signature, Nobitex-Timestamp
 * payload = timestamp + METHOD + full_path_with_query + raw_body
 */
export async function privateRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; retryable?: boolean } = {}
): Promise<unknown> {
  const keys = loadKeys();
  if (!keys) throw createError({ statusCode: 400, statusMessage: "کلید API ذخیره نشده است" });
  // فقط خواندن (GET) بدون فعال‌سازی معامله واقعی مجاز است؛ ارسال/لغو سفارش نیاز به تأیید روشن دارد
  if (method !== "GET" && !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نشده است (نیاز به تأیید روشن کاربر)" });
  }

  const qs = opts.query
    ? new URLSearchParams(
        Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== "")
      ).toString()
    : "";
  const queryString = qs ? `?${qs}` : "";
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";

  const fullPath = `${path}${queryString}`;
  const url = `${baseUrl(keys.sandbox)}${fullPath}`;
  // GET is idempotent. Mutating requests are never retried unless the caller
  // explicitly marks the operation idempotent (for example order cancellation).
  const canRetry = method === "GET" || opts.retryable === true;
  try {
    decodePrivateKey(keys.apiSecret);
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message });
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signatureUrlSafe = signApiRequest(keys.apiSecret, timestamp, method, fullPath, bodyStr);
    try {
      const res = await guardedFetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "TraderBot/Tradeban",
          "Nobitex-Key": keys.apiKey,
          "Nobitex-Signature": signatureUrlSafe,
          "Nobitex-Timestamp": timestamp,
        },
        body: method === "GET" ? undefined : bodyStr || undefined,
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 429) {
        lastErr = new Error("rate limited");
        if (canRetry && attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        if (!canRetry) throw new NobitexRequestError("Rate Limit نوبیتکس؛ برای جلوگیری از سفارش تکراری تلاش خودکار انجام نشد", 429, false);
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // پاسخ‌های فعلی عموماً status:"ok" دارند. برخی endpointها status ندارند.
      const status = typeof json.status === "string" ? json.status.toUpperCase() : "";
      if (!res.ok || (status && status !== "OK" && status !== "SUCCESS")) {
        const detail = String(json.detail ?? json.message ?? json.code ?? JSON.stringify(json).slice(0, 200));
        const friendly = /api key is invalid/i.test(detail)
          ? "API Key نوبیتکس معتبر نیست؛ مقدار public `key` را وارد کنید، نه User Token یا privateKey."
          : /signature/i.test(detail)
            ? "امضای درخواست پذیرفته نشد؛ کلید خصوصی با کلید عمومی ثبت‌شده در نوبیتکس جفت نیست."
            : detail;
        throw new NobitexRequestError(friendly, res.status || 502, res.status >= 500);
      }
      return json;
    } catch (err) {
      console.log(`[nobitex] ${method} ${url} -> FAILED in ${Date.now() - started}ms | ${errDetail(err)}`);
      lastErr = err;
      if (
        !canRetry ||
        (err instanceof NobitexRequestError && (!err.retryable || err.statusCode === 503))
      ) {
        throw toHttpError(err);
      }
      // مکث ۳۰ ثانیه‌ای فقط برای Rate Limit (429)؛ خطاهای شبکه با مکث کوتاه تلاش مجدد می‌شوند
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw toHttpError(lastErr);
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * پذیرش کلید خصوصی Ed25519 در همه فرمت‌های رایج:
 * Base64 / Base64url (seed یا seed+pub)، hex ۶۴/۱۲۸ کاراکتری، و PKCS#8 DER (با یا بدون PEM).
 */
export function decodePrivateKey(value: string): Buffer {
  const cleaned = value
    .trim()
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/gi, "")
    .replace(/-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, "")
    .replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(cleaned) && (cleaned.length === 64 || cleaned.length === 128)) {
    return Buffer.from(cleaned.slice(0, 64), "hex");
  }
  const normalized = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  // Some exporters append the public key to the 32-byte seed.
  if (decoded.length === 64) return decoded.subarray(0, 32);
  if (decoded.length === 48 && decoded.subarray(0, 16).equals(PKCS8_ED25519_PREFIX)) {
    return decoded.subarray(16);
  }
  if (decoded.length === 32) return decoded;
  throw new Error(
    `کلید خصوصی Ed25519 نوبیتکس معتبر نیست؛ فرمت‌های پذیرفته‌شده: Base64 یا Base64url یا hexِ seed سی‌ودوبایته. ورودی شما ${cleaned.length} کاراکتر است — مقدار «کلید خصوصی» ساخته‌شده در نوبیتکس را وارد کنید، نه User Token یا API Key.`
  );
}

/** تبدیل خطاهای داخلی به خطای HTTP استاندارد تا h3 آن‌ها را unhandled (500) نبیند. */
export function toHttpError(err: unknown): Error {
  if (err instanceof NobitexRequestError) {
    const statusMessage =
      err.statusCode === 503 && /circuit breaker/i.test(err.message)
        ? "نوبیتکس موقتاً در دسترس نیست (قطع اتصال شبکه)؛ حداکثر تا یک دقیقه دیگر دوباره تلاش می‌شود."
        : err.message;
    return createError({
      statusCode: err.statusCode,
      statusMessage,
      data: { code: "NOBITEX_ERROR", retryable: err.retryable },
    });
  }
  if (err instanceof Error && typeof (err as { statusCode?: number }).statusCode === "number") {
    return err; // قبلاً خطای h3 است
  }
  return createError({
    statusCode: 503,
    statusMessage: `دسترسی به نوبیتکس ممکن نشد: ${errDetail(err)}`,
    data: { code: "UPSTREAM_DOWN" },
  });
}

export function signApiRequest(
  privateKeyValue: string,
  timestamp: string,
  method: "GET" | "POST" | "DELETE",
  fullPath: string,
  rawBody: string,
): string {
  const rawPrivateKey = decodePrivateKey(privateKeyValue);
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), rawPrivateKey]),
    format: "der",
    type: "pkcs8",
  });
  const payload = `${timestamp}${method}${fullPath}${rawBody}`;
  const signatureBase64 = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
  return signatureBase64.replace(/\+/g, "-").replace(/\//g, "_");
}

/** اعتبارسنجی نماد برای جلوگیری از تزریق ورودی */
export function assertValidSymbol(symbol: string): string {
  if (!/^[A-Z]{2,12}IRT$/.test(symbol)) throw new Error("نماد نامعتبر");
  return symbol;
}
