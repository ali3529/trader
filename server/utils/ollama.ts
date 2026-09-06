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

export function ollamaConfig(): OllamaConfig {
  const rawUrl = String(process.env.NITRO_OLLAMA_URL ?? "http://127.0.0.1:11434").trim();
  const baseUrl = rawUrl.replace(/\/+$/, "");
  const model = String(process.env.NITRO_OLLAMA_MODEL ?? "qwen3:4b").trim();
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("آدرس Ollama معتبر نیست");
  if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(model)) throw new Error("نام مدل Ollama معتبر نیست");
  return { baseUrl, model };
}

export async function listOllamaModels(config: OllamaConfig): Promise<string[]> {
  const response = await fetch(`${config.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json() as OllamaTagsResponse;
  return (body.models ?? [])
    .map((item) => item.name ?? item.model ?? "")
    .filter(Boolean);
}

export async function analyzeWithQwen(
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
      format: {
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
      },
      options: { temperature: 0.1, num_predict: 450 },
      messages: [
        {
          role: "system",
          content: [
            "شما تنها یک تحلیلگر ریسک مشورتی هستید.",
            "پاسخ را فارسی، کوتاه و فقط مطابق schema برگردانید.",
            "هیچ دستور خرید، فروش یا اجرای معامله ندهید و سود را تضمین نکنید.",
            "فقط داده‌های ارسالی را تفسیر کنید؛ قواعد قطعی استراتژی و ریسک قرار نیست بدهید.",
          ].join(" "),
        },
        {
          role: "user",
          content: `این snapshot سیگنال را بررسی کن:\n${JSON.stringify(marketSnapshot)}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  const body = await response.json() as { message?: { content?: string } };
  const raw = body.message?.content;
  if (!raw) throw new Error("پاسخ Ollama خالی بود");
  const parsed = JSON.parse(raw) as Partial<QwenAnalysis>;
  if (
    typeof parsed.summary !== "string" ||
    !["support", "neutral", "caution"].includes(String(parsed.verdict)) ||
    typeof parsed.confidence !== "number" ||
    !Array.isArray(parsed.observations) ||
    !Array.isArray(parsed.risks)
  ) {
    throw new Error("ساختار پاسخ Qwen معتبر نیست");
  }
  return {
    summary: parsed.summary.slice(0, 800),
    verdict: parsed.verdict as QwenAnalysis["verdict"],
    confidence: Math.max(0, Math.min(100, parsed.confidence)),
    observations: parsed.observations.filter((x): x is string => typeof x === "string").slice(0, 4),
    risks: parsed.risks.filter((x): x is string => typeof x === "string").slice(0, 4),
  };
}
