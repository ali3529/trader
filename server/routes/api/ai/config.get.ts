import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { DEFAULT_QWEN_BASE_URL, loadAiConfig } from "../../../utils/ollama";

/** تنظیمات AI بدون توکن کامل — توکن هرگز به فرانت‌اند برنمی‌گردد */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  let config;
  try {
    config = loadAiConfig();
  } catch {
    config = {
      provider: "ollama" as const,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      qwenModel: "qwen-plus",
      qwenToken: "",
    };
  }
  return {
    provider: config.provider,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    qwenBaseUrl: config.qwenBaseUrl,
    qwenModel: config.qwenModel,
    hasToken: Boolean(config.qwenToken),
    tokenMasked: config.qwenToken ? `••••${config.qwenToken.slice(-4)}` : null,
  };
});
