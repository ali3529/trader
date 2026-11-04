import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadAiConfig, listOllamaModels, hasJevToken, getJevClient } from "../../../utils/jev";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  let config;
  try {
    config = await loadAiConfig();
  } catch (error) {
    return {
      provider: "ollama",
      reachable: false,
      ready: false,
      model: "",
      installedModels: [],
      error: (error as Error).message,
    };
  }
  try {
    if (config.provider === "ollama") {
      const models = await listOllamaModels({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
      });
      return {
        provider: "ollama",
        reachable: true,
        ready: models.includes(config.ollamaModel),
        model: config.ollamaModel,
        installedModels: models,
      };
    }
    // بررسی سلامت Jev: توکن موجود باشد و بتوان کلاینت ساخت
    if (!hasJevToken(config.jevToken)) {
      return {
        provider: "jev",
        reachable: false,
        ready: false,
        model: config.jevModel,
        installedModels: [],
        error: "توکن Jev ذخیره نشده است",
      };
    }
    getJevClient(config);
    return {
      provider: "jev",
      reachable: true,
      ready: true,
      model: config.jevModel,
      installedModels: [],
    };
  } catch (error) {
    return {
      provider: config.provider,
      reachable: false,
      ready: false,
      model: config.provider === "ollama" ? config.ollamaModel : config.jevModel,
      installedModels: [],
      error: (error as Error).message,
    };
  }
});
