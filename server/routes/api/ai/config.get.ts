import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadAiConfig } from "../../../utils/jev";

/** تنظیمات AI بدون توکن کامل — توکن هرگز به فرانت‌اند برنمی‌گردد */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  let config;
  try {
    config = await loadAiConfig();
  } catch {
    config = {
      provider: "ollama" as const,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3:4b",
      jevBaseUrl: "",
      jevModel: "jev-latest",
      jevToken: "",
    };
  }
  return {
    provider: config.provider,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    jevBaseUrl: config.jevBaseUrl,
    jevModel: config.jevModel,
    hasToken: Boolean(config.jevToken),
    tokenMasked: config.jevToken ? `••••${config.jevToken.slice(-4)}` : null,
  };
});
