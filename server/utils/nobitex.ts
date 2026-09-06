import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

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

const BASE_URL = "https://api.nobitex.ir";
// طبق مستندات رسمی، محیط سندباکس دامنه اختصاصی و هدر X-Sandbox دارد
const SANDBOX_URL = "https://api.sandbox.nobitex.ir";
const DATA_DIR = join(process.cwd(), ".tradeban");
const KEYS_FILE = join(DATA_DIR, "keys.enc.json");
const MASTER_FILE = join(DATA_DIR, "master.key");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000;

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
  if (existsSync(KEYS_FILE)) writeFileSync(KEYS_FILE, "");
}

export function baseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_URL : BASE_URL;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** درخواست عمومی با Rate Limit: حداکثر ۳ تلاش مجدد با ۳۰ ثانیه مکث */
export async function publicGet(path: string, params: Record<string, string>, sandbox = false): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl(sandbox)}${path}${qs ? `?${qs}` : ""}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const latency = Date.now() - started;
      const text = await res.text().catch(() => "");
      console.log(`[nobitex] GET ${url} -> HTTP ${res.status} in ${latency}ms | body: ${text.slice(0, 200)}`);
      if (res.status === 429) {
        lastErr = new Error("rate limited");
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!res.ok) {
        throw new Error(`nobitex ${res.status}: ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    } catch (err) {
      console.log(`[nobitex] GET ${url} -> FAILED in ${Date.now() - started}ms | ${(err as Error).message}`);
      lastErr = err;
      // مکث ۳۰ ثانیه‌ای فقط برای Rate Limit (429)؛ خطاهای شبکه با مکث کوتاه تلاش مجدد می‌شوند
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * درخواست امضاشده خصوصی نوبیتکس — طبق مستندات رسمی apidocs.nobitex.ir:
 * headers: A-Key, A-Signature, A-Nonce (و X-Sandbox برای محیط آزمایشی)
 * payload امضا = رشته کوئری (با «?» دقیقاً به همان ترتیبی که ارسال می‌شود) + بدنه JSON + nonce
 * نکته مهم مستندات: مسیر endpoint در امضا نقش ندارد و کوئری‌ها مرتب (sort) نمی‌شوند.
 */
export async function privateRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<unknown> {
  const keys = loadKeys();
  if (!keys) throw new Error("کلید API ذخیره نشده است");
  // فقط خواندن (GET) بدون فعال‌سازی معامله واقعی مجاز است؛ ارسال/لغو سفارش نیاز به تأیید روشن دارد
  if (method !== "GET" && !keys.realEnabled) {
    throw new Error("معامله واقعی فعال نشده است (نیاز به تأیید روشن کاربر)");
  }

  const qs = opts.query
    ? new URLSearchParams(
        Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== "")
      ).toString()
    : "";
  const queryString = qs ? `?${qs}` : "";
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";

  const url = `${baseUrl(keys.sandbox)}/api${path}${queryString}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // nonce تازه برای هر تلاش — امضا طبق مستندات روی (query string + body + nonce) محاسبه می‌شود
    const nonce = Date.now().toString();
    const signature = createHmac("sha512", keys.apiSecret)
      .update(queryString + bodyStr + nonce)
      .digest("hex");
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "A-Key": keys.apiKey,
          "A-Signature": signature,
          "A-Nonce": nonce,
          ...(keys.sandbox ? { "X-Sandbox": "1" } : {}),
        },
        body: method === "GET" ? undefined : bodyStr || undefined,
      });
      if (res.status === 429) {
        lastErr = new Error("rate limited");
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // مستندات: پاسخ موفق با status برابر "OK" (ثبت/لغو سفارش) یا بدون خطا برمی‌گردد
      const status = typeof json.status === "string" ? json.status.toUpperCase() : "";
      if (!res.ok || (status && status !== "OK" && status !== "SUCCESS")) {
        throw new Error(`nobitex: ${JSON.stringify(json).slice(0, 200)}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      // مکث ۳۰ ثانیه‌ای فقط برای Rate Limit (429)؛ خطاهای شبکه با مکث کوتاه تلاش مجدد می‌شوند
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** اعتبارسنجی نماد برای جلوگیری از تزریق ورودی */
export function assertValidSymbol(symbol: string): string {
  if (!/^[A-Z]{2,12}IRT$/.test(symbol)) throw new Error("نماد نامعتبر");
  return symbol;
}
