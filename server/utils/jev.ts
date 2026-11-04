import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";
import type { TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { readState, writeState } from "./stateStore";

/**
 * لایهٔ تحلیلگر AI — Jev (System One از TypeSafe AI).
 * مدل فقط snapshot سیگنال را می‌بیند؛ کلید صرافی، موجودی خصوصی و اختیار
 * ارسال سفارش هرگز در اختیار آن قرار نمی‌گیرد. توکن فقط رمزنگاری‌شده
 * (AES-256-GCM) در .tradeban سمت سرور ذخیره می‌شود و به مرورگر برنمی‌گردد.
 *
 * تصمیم‌گیری دربارهٔ باز کردن پوزیشن در aiGate.ts انجام می‌شود: Jev می‌تواند
 * ورود را رد کند یا سایز را کاهش دهد، اما هرگز به‌تنهایی پوزیشن باز نمی‌کند.
 */

const AI_STATE_FILE = "ai-config.json";

export interface AiConfig {
  provider: "ollama" | "jev";
  /** آدرس Ollama محلی (فقط وقتی provider = ollama) */
  ollamaBaseUrl: string;
  /** نام مدل Ollama محلی (فقط وقتی provider = ollama) */
  ollamaModel: string;
  /** توکن Jev — هرگز به فرانت‌اند برنمی‌گردد */
  jevToken: string;
  /** آدرس API اختیاری (پیش‌فرض: api.typesafe.ai) */
  jevBaseUrl: string;
  /** مدل Jev (پیش‌فرض: jev-latest) */
  jevModel: string;
}

const HTTPS_URL = /^https:\/\/[^\s]{3,160}$/;
const HTTP_URL = /^https?:\/\/[^\s]{3,160}$/;
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,120}$/;
const TOKEN_CHARS = /^[A-Za-z0-9._-]{8,200}$/;

function assertValidAiConfig(cfg: AiConfig): void {
  if (cfg.provider !== "ollama" && cfg.provider !== "jev") {
    throw new Error("ارائه‌دهنده AI نامعتبر است");
  }
  if (!HTTP_URL.test(cfg.ollamaBaseUrl)) throw new Error("آدرس Ollama معتبر نیست");
  if (!MODEL_NAME.test(cfg.ollamaModel)) throw new Error("نام مدل Ollama معتبر نیست");
  if (cfg.jevBaseUrl && !HTTPS_URL.test(cfg.jevBaseUrl)) {
    throw new Error("آدرس API باید https باشد");
  }
  if (cfg.jevModel && !MODEL_NAME.test(cfg.jevModel)) {
    throw new Error("نام مدل Jev معتبر نیست");
  }
  if (cfg.jevToken && !TOKEN_CHARS.test(cfg.jevToken)) {
    throw new Error("قالب توکن Jev معتبر نیست");
  }
}

/** تنظیمات فعال AI: اول ذخیرهٔ رمزنگاری‌شده کاربر، بعد متغیرهای محیطی، بعد پیش‌فرض‌ها */
export async function loadAiConfig(): Promise<AiConfig> {
  const stored = await readState<Partial<AiConfig>>(AI_STATE_FILE, {});
  const config: AiConfig = {
    provider: stored.provider === "jev" ? "jev" : "ollama",
    ollamaBaseUrl: String(stored.ollamaBaseUrl ?? process.env.NITRO_OLLAMA_URL ?? "http://127.0.0.1:11434")
      .trim()
      .replace(/\/+$/, ""),
    ollamaModel: String(stored.ollamaModel ?? process.env.NITRO_OLLAMA_MODEL ?? "qwen3:4b").trim(),
    jevToken: String(stored.jevToken ?? process.env.TYPESAFE_API_KEY ?? "").trim(),
    jevBaseUrl: String(stored.jevBaseUrl ?? process.env.TYPESAFE_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    jevModel: String(stored.jevModel ?? process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest").trim(),
  };
  assertValidAiConfig(config);
  return config;
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  assertValidAiConfig(config);
  await writeState(AI_STATE_FILE, {
    provider: config.provider,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    jevToken: config.jevToken,
    jevBaseUrl: config.jevBaseUrl,
    jevModel: config.jevModel,
  });
}

/* ------------------------------- کلاینت Jev ------------------------------- */

let cachedClient: { key: string; client: TypeSafeClient } | null = null;

function clientKey(cfg: AiConfig): string {
  return `${cfg.jevToken}::${cfg.jevBaseUrl}::${cfg.jevModel}`;
}

/**
 * کلاینت Jev با کش سبک: فقط وقتی token/baseUrl/model تغییر کرد کلاینت جدید
 * می‌سازد. `dangerouslyAllowBrowser` هرگز روشن نیست — این کلاینت فقط سمت سرور است.
 */
export function getJevClient(cfg: AiConfig): TypeSafeClient {
  if (!hasJevToken(cfg.jevToken)) {
    throw new Error("توکن Jev ذخیره نشده است — در تنظیمات → تحلیلگر AI وارد کنید");
  }
  const key = clientKey(cfg);
  if (cachedClient && cachedClient.key === key) return cachedClient.client;

  const options: TypeSafeClientConfig = {
    apiKey: cfg.jevToken,
    timeout: 30_000,
    retry: { maxRetries: 1 },
  };
  if (cfg.jevBaseUrl) options.baseURL = cfg.jevBaseUrl;
  if (cfg.jevModel) options.defaultModel = cfg.jevModel;

  const client = new TypeSafeClient(options);
  cachedClient = { key, client };
  return client;
}

/** آیا توکن Jev در دسترس است؟ */
export function hasJevToken(token: string): boolean {
  return Boolean(token && token.trim().length >= 8);
}

/* ------------------------------- Ollama محلی ------------------------------- */

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

/** فهرست مدل‌های نصب‌شده روی Ollama محلی (برای بررسی سلامت provider محلی) */
export async function listOllamaModels(config: OllamaConfig): Promise<string[]> {
  const response = await fetch(`${config.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = (await response.json()) as OllamaTagsResponse;
  return (body.models ?? [])
    .map((item) => item.name ?? item.model ?? "")
    .filter(Boolean);
}

/* --------------------------- تحلیل مشورتی Jev --------------------------- */

export interface JevRisk {
  score: number;
  confidence: number;
  label: string;
}

export interface JevAction {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export interface JevAnalysis {
  decision: number;
  risk: JevRisk;
  action: JevAction;
}

export interface AiAnalysisInput {
  symbol: string;
  price: number;
  changePct24h: number;
  volume24h: number;
  signal: unknown;
}

const RISK_RUBRIC = [
  "No risk",
  "Low risk",
  "Medium risk",
  "High risk",
  "Extreme risk",
] as const;

const ACTION_RUBRIC = [
  "Execute trade",
  "Wait",
  "Reject",
  "Reduce position",
] as const;

/**
 * تحلیل مشاورهٔ یک فرصت با Jev. این تابع فقط قضاوت می‌کند و هیچ سفارشی
 * صادر نمی‌کند — تصمیم نهایی دربارهٔ ورود در aiGate.ts با درنظرگرفتن
 * ریسک پورتفو گرفته می‌شود.
 */
export async function analyzeWithJev(cfg: AiConfig, input: AiAnalysisInput): Promise<JevAnalysis> {
  const client = getJevClient(cfg);
  const result = await client.systemOne({
    state: [
      "You are a crypto trading risk decision engine for a spot market.",
      "Analyze this opportunity and judge whether a long position should be opened.",
      "Base your judgment only on the provided data.",
      "",
      `Symbol: ${input.symbol}`,
      `Current price: ${input.price}`,
      `24h change (%): ${input.changePct24h}`,
      `24h volume (quote): ${input.volume24h}`,
      `Signal: ${JSON.stringify(input.signal)}`,
    ].join("\n"),
    questions: {
      decision: noul("Should this trade be executed?"),
      risk: score("How risky is this trade?", RISK_RUBRIC),
      action: score("What action should the trading bot take?", ACTION_RUBRIC),
    },
  });

  const risk = result.answers.risk;
  const action = result.answers.action;
  return {
    decision: result.answers.decision.noul,
    risk: {
      score: risk.score,
      confidence: risk.confidence,
      label: String(risk.legend[Math.round(risk.score)] ?? ""),
    },
    action: {
      type: "score",
      score: action.score,
      confidence: action.confidence,
      legend: Object.fromEntries(
        Object.entries(action.legend).map(([k, v]) => [String(k), String(v as string)]),
      ),
      probabilities: Object.fromEntries(
        Object.entries(action.probabilities).map(([k, v]) => [String(k), Number(v as number)]),
      ),
    },
  };
}