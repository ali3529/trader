import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { DEFAULT_QWEN_BASE_URL, loadAiConfig, saveAiConfig } from "../../../utils/ollama";
import type { AiConfig } from "../../../utils/ollama";

interface Body {
  provider?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  qwenBaseUrl?: string;
  qwenModel?: string;
  /** فقط وقتی غیرخالی است جایگزین توکن ذخیره‌شده می‌شود */
  qwenToken?: string;
}

export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<Body>(event);
  let current: AiConfig;
  try {
    current = await loadAiConfig();
  } catch {
    current = {
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      qwenModel: "qwen-plus",
      qwenToken: "",
    };
  }
  const token = String(body?.qwenToken ?? "").trim();
  const next: AiConfig = {
    provider: body?.provider === "qwen-cloud" ? "qwen-cloud" : "ollama",
    ollamaBaseUrl: String(body?.ollamaBaseUrl ?? "").trim() || current.ollamaBaseUrl,
    ollamaModel: String(body?.ollamaModel ?? "").trim() || current.ollamaModel,
    qwenBaseUrl: String(body?.qwenBaseUrl ?? "").trim() || current.qwenBaseUrl,
    qwenModel: String(body?.qwenModel ?? "").trim() || current.qwenModel,
    qwenToken: token || current.qwenToken,
  };
  try {
    await saveAiConfig(next);
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message });
  }
  return { ok: true, hasToken: Boolean(next.qwenToken) };
});
