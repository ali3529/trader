import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * لایهٔ ذخیرهٔ متحد state حساسِ رمزنگاری‌شده — دو بک‌اند:
 * - `fs`: محلی یا VM (پیش‌فرض) — پوشهٔ `.tradeban` یا TRADEBAN_STATE_DIR
 * - `kv`: Upstash Redis یکپارچه با Vercel (متغیرهای KV_REST_API_URL / KV_REST_API_TOKEN)
 *
 * روی Vercel serverless فایل‌سیستم موقتی است؛ بدون KV، state فقط تا warm ماندن
 * نمونه در `/tmp` دوام می‌آورد. رمزنگاری همیشه AES-256-GCM است و کلید master از
 * TRADEBAN_SECRET می‌آید؛ در غیاب آن یک فایل محلی (فقط برای توسعهٔ محلی).
 */

export type StateBackend = "kv" | "fs";

const KV_URL = String(process.env.KV_REST_API_URL ?? "").trim();
const KV_TOKEN = String(process.env.KV_REST_API_TOKEN ?? "").trim();
export const STATE_BACKEND: StateBackend = KV_URL && KV_TOKEN ? "kv" : "fs";
const KV_PREFIX = "tradeban:state:";

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR =
  String(process.env.TRADEBAN_STATE_DIR ?? "").trim() ||
  (IS_SERVERLESS ? "/tmp/tradeban" : join(process.cwd(), ".tradeban"));
const MASTER_FILE = join(DATA_DIR, "master.key");

const NAME_RE = /^[a-z0-9.-]{1,80}$/i;

function assertName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error("نام state امن نامعتبر است");
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function masterSecret(): string {
  const envSecret = String(process.env.TRADEBAN_SECRET ?? "").trim();
  if (envSecret) return envSecret;
  ensureDir();
  if (!existsSync(MASTER_FILE)) {
    writeFileSync(MASTER_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
    chmodSync(MASTER_FILE, 0o600);
  }
  return readFileSync(MASTER_FILE, "utf8");
}

let warnedMaster = false;
function deriveKey(): Buffer {
  if (STATE_BACKEND === "kv" && !process.env.TRADEBAN_SECRET && !warnedMaster) {
    warnedMaster = true;
    console.warn("[state] بک‌اند KV بدون TRADEBAN_SECRET فعال است — کلید رمزنگاری پس از cold start پایدار نخواهد بود.");
  }
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

/* --------------------------------- fs backend --------------------------------- */

function fsRead(name: string): string | null {
  const target = join(DATA_DIR, name);
  if (!existsSync(target)) return null;
  return readFileSync(target, "utf8");
}

function fsWrite(name: string, payload: string): void {
  ensureDir();
  const target = join(DATA_DIR, name);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, payload, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
}

function fsDelete(name: string): void {
  const target = join(DATA_DIR, name);
  if (existsSync(target)) unlinkSync(target);
}

/* --------------------------------- kv backend --------------------------------- */

async function kvCommand(command: unknown[]): Promise<unknown> {
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!response.ok || body?.error) {
    throw new Error(`KV ${String(body?.error ?? response.status)}`);
  }
  return body?.result ?? null;
}

/* ----------------------------------- API ----------------------------------- */

export async function readState<T>(name: string, fallback: T): Promise<T> {
  assertName(name);
  try {
    const payload =
      STATE_BACKEND === "kv"
        ? ((await kvCommand(["GET", KV_PREFIX + name])) as string | null)
        : fsRead(name);
    if (!payload) return fallback;
    return decryptJson<T>(payload);
  } catch (error) {
    console.log(`[state] read ${name} failed | ${(error as Error).message}`);
    return fallback;
  }
}

export async function writeState(name: string, value: unknown): Promise<void> {
  assertName(name);
  const payload = encryptJson(value);
  if (STATE_BACKEND === "kv") {
    await kvCommand(["SET", KV_PREFIX + name, payload]);
  } else {
    fsWrite(name, payload);
  }
}

export async function deleteState(name: string): Promise<void> {
  assertName(name);
  if (STATE_BACKEND === "kv") {
    await kvCommand(["DEL", KV_PREFIX + name]);
  } else {
    fsDelete(name);
  }
}
