import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadAiConfig, saveAiConfig } from "../../../utils/jev";
import type { AiConfig } from "../../../utils/jev";

interface Body {
  provider?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  jevBaseUrl?: string;
  jevModel?: string;
  /** فقط وقتی غیرخالی است جایگزین توکن ذخیره‌شده می‌شود */
  jevToken?: string;
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
      jevBaseUrl: "",
      jevModel: "jev-latest",
      jevToken: "",
    };
  }
  const token = String(body?.jevToken ?? "").trim();
  const next: AiConfig = {
    provider: body?.provider === "jev" ? "jev" : "ollama",
    ollamaBaseUrl: String(body?.ollamaBaseUrl ?? "").trim() || current.ollamaBaseUrl,
    ollamaModel: String(body?.ollamaModel ?? "").trim() || current.ollamaModel,
    jevBaseUrl: String(body?.jevBaseUrl ?? "").trim() || current.jevBaseUrl,
    jevModel: String(body?.jevModel ?? "").trim() || current.jevModel,
    jevToken: token || current.jevToken,
  };
  try {
    await saveAiConfig(next);
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message });
  }
  return { ok: true, hasToken: Boolean(next.jevToken) };
});
