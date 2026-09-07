import { loadSecureState, saveSecureState } from "./nobitex";

/**
 * لایهٔ تحلیلگر AI — دو ارائه‌دهنده:
 * ۱) ollama: مدل محلی (پیش‌فرض qwen3:4b) روی دستگاه کاربر
 * ۲) qwen-cloud: سرویس ابری Qwen با توکن API (endpoint سازگار با OpenAI، پیش‌فرض DashScope)
 * توکن ابری فقط رمزنگاری‌شده (AES-256-GCM) در .tradeban سمت سرور ذخیره می‌شود.
 */

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

export interface QwenAnalysis {
  summary: string;
  verdict: "support" | "neutral" | "caution";
  confidence: number;
  observations: string[];
  risks: string[];
}

export type AiProvider = "ollama" | "qwen-cloud";

export interface AiConfig {
  provider: AiProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  qwenBaseUrl: string;
  qwenModel: string;
  qwenToken: string;
}

export const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const AI_STATE_FILE = "ai-config.json";

const HTTP_URL = /^https?:\/\/[^\s]{3,160}$/;
const HTTPS_URL = /^https:\/\/[^\s]{3,160}$/;
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,120}$/;
const TOKEN_CHARS = /^[A-Za-z0-9._-]{8,200}$/;

function assertValidAiConfig(cfg: AiConfig): void {
  if (cfg.provider !== "ollama" && cfg.provider !== "qwen-cloud") {
    throw new Error("ارائه‌دهنده AI نامعتبر است");
  }
  if (!HTTP_URL.test(cfg.ollamaBaseUrl)) throw new Error("آدرس Ollama معتبر نیست");
  if (!MODEL_NAME.test(cfg.ollamaModel)) throw new Error("نام مدل Ollama معتبر نیست");
  if (!HTTPS_URL.test(cfg.qwenBaseUrl)) throw new Error("آدرس ابر Qwen باید https باشد");
  if (!MODEL_NAME.test(cfg.qwenModel)) throw new Error("نام مدل Qwen معتبر نیست");
  if (cfg.qwenToken && !TOKEN_CHARS.test(cfg.qwenToken)) throw new Error("قالب توکن Qwen معتبر نیست");
}

/** تنظیمات فعال AI: اول ذخیرهٔ رمزنگاری‌شده کاربر، بعد متغیرهای محیطی، بعد پیش‌فرض‌ها */
export function loadAiConfig(): AiConfig {
  const stored = loadSecureState<Partial<AiConfig>>(AI_STATE_FILE, {});
  const config: AiConfig = {
    provider: stored.provider === "qwen-cloud" ? "qwen-cloud" : "ollama",
    ollamaBaseUrl: String(stored.ollamaBaseUrl ?? process.env.NITRO_OLLAMA_URL ?? "http://127.0.0.1:11434")
      .trim()
      .replace(/\/+$/, ""),
    ollamaModel: String(stored.ollamaModel ?? process.env.NITRO_OLLAMA_MODEL ?? "qwen3:4b").trim(),
    qwenBaseUrl: String(stored.qwenBaseUrl ?? DEFAULT_QWEN_BASE_URL).trim().replace(/\/+$/, ""),
    qwenModel: String(stored.qwenModel ?? "qwen-plus").trim(),
    qwenToken: String(stored.qwenToken ?? "").trim(),
  };
  assertValidAiConfig(config);
  return config;
}

export function saveAiConfig(config: AiConfig): void {
  assertValidAiConfig(config);
  saveSecureState(AI_STATE_FILE, {
    provider: config.provider,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    qwenBaseUrl: config.qwenBaseUrl,
    qwenModel: config.qwenModel,
    qwenToken: config.qwenToken,
  });
}

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

export async function listQwenCloudModels(config: AiConfig): Promise<string[]> {
  if (!config.qwenToken) throw new Error("توکن Qwen ذخیره نشده است");
  const response = await fetch(`${config.qwenBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.qwenToken}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("توکن Qwen معتبر نیست (401/403)");
  }
  if (!response.ok) throw new Error(`Qwen HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
}

const SYSTEM_PROMPT = [
  "شما تنها یک تحلیلگر ریسک مشورتی هستید.",
  "پاسخ را فارسی، کوتاه و فقط مطابق schema برگردانید.",
  "هیچ دستور خرید، فروش یا اجرای معامله ندهید و سود را تضمین نکنید.",
  "فقط داده‌های ارسالی را تفسیر کنید؛ قواعد قطعی استراتژی و ریسک قرار نیست بدهید.",
].join(" ");

/** مدل‌ها گاهی JSON را داخل ```json fence یا همراه متن اضافه برمی‌گردانند */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return unfenced;
  return unfenced.slice(start, end + 1);
}

/** تحمل‌پذیر نسبت به خروجی مدل: انواع را coerce می‌کند به‌جای رد کردن کل پاسخ */
function normalizeAnalysis(parsed: Partial<QwenAnalysis>): QwenAnalysis {
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("پاسخ مدل خلاصه (summary) نداشت");
  const verdictRaw = String(parsed.verdict ?? "").toLowerCase();
  const verdict: QwenAnalysis["verdict"] = (["support", "neutral", "caution"] as const).includes(
    verdictRaw as QwenAnalysis["verdict"]
  )
    ? (verdictRaw as QwenAnalysis["verdict"])
    : "neutral";
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, confidenceRaw)) : 50;
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((x) => String(x).trim()).filter((s) => s.length > 0).slice(0, 4)
      : [];
  return {
    summary: summary.slice(0, 800),
    verdict,
    confidence,
    observations: asStrings(parsed.observations),
    risks: asStrings(parsed.risks),
  };
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    verdict: { type: "string", enum: ["support", "neutral", "caution"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    observations: { type: "array", items: { type: "string" }, maxItems: 4 },
    risks: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: ["summary", "verdict", "confidence", "observations", "risks"],
  additionalProperties: false,
};

async function analyzeWithOllama(
  config: OllamaConfig,
  marketSnapshot: Record<string, unknown>,
): Promise<QwenAnalysis> {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: config.model,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: JSON_SCHEMA,
      options: { temperature: 0.1, num_predict: 450 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `این snapshot سیگنال را بررسی کن:\n${JSON.stringify(marketSnapshot)}` },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const body = (await response.json()) as { message?: { content?: string } };
  const raw = body.message?.content;
  if (!raw) throw new Error("پاسخ Ollama خالی بود");
  return normalizeAnalysis(JSON.parse(extractJson(raw)) as Partial<QwenAnalysis>);
}

async function analyzeWithQwenCloud(
  config: AiConfig,
  marketSnapshot: Record<string, unknown>,
): Promise<QwenAnalysis> {
  if (!config.qwenToken) throw new Error("توکن Qwen ذخیره نشده است");
  const response = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.qwenToken}`,
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.qwenModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT} خروجی فقط یک شیء JSON معتبر باشد.` },
        { role: "user", content: `این snapshot سیگنال را بررسی کن و فقط JSON برگردان:\n${JSON.stringify(marketSnapshot)}` },
      ],
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("توکن Qwen معتبر نیست (401/403) — توکن همان منطقه (intl یا چین) را در تنظیمات ذخیره کنید");
  }
  if (response.status === 404) {
    throw new Error("مسیر یا مدل پیدا نشد (404) — base url و نام مدل را در تنظیمات بررسی کنید");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Qwen HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error("پاسخ Qwen خالی بود");
  return normalizeAnalysis(JSON.parse(extractJson(raw)) as Partial<QwenAnalysis>);
}

/** تحلیل مشورتی snapshot سیگنال با ارائه‌دهندهٔ انتخاب‌شده در تنظیمات */
export async function analyzeWithAi(
  config: AiConfig,
  marketSnapshot: Record<string, unknown>,
): Promise<QwenAnalysis> {
  const label =
    config.provider === "qwen-cloud"
      ? `Qwen ابری (${config.qwenModel})`
      : `Ollama (${config.ollamaModel})`;
  try {
    if (config.provider === "qwen-cloud") {
      return await analyzeWithQwenCloud(config, marketSnapshot);
    }
    return await analyzeWithOllama(
      { baseUrl: config.ollamaBaseUrl, model: config.ollamaModel },
      marketSnapshot,
    );
  } catch (error) {
    const message = (error as Error).message;
    if (config.provider === "ollama" && /fetch failed|ECONNREFUSED|aborted|timeout/i.test(message)) {
      throw new Error(
        `Ollama روی این دستگاه در دسترس نیست (مدل ${config.ollamaModel}) — یا سرویس Ollama اجرا نیست یا مدل نصب نیست؛ در تنظیمات → AI ارائه‌دهنده را روی «Qwen ابری» بگذارید یا Ollama را شروع کنید.`
      );
    }
    throw new Error(`${label}: ${message}`);
  }
}
