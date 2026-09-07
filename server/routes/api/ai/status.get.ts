import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadAiConfig, listOllamaModels, listQwenCloudModels } from "../../../utils/ollama";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  let config;
  try {
    config = loadAiConfig();
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
    const models = await listQwenCloudModels(config);
    const ready = models.length === 0 || models.includes(config.qwenModel);
    return {
      provider: "qwen-cloud",
      reachable: true,
      ready,
      model: config.qwenModel,
      installedModels: models,
    };
  } catch (error) {
    return {
      provider: config.provider,
      reachable: false,
      ready: false,
      model: config.provider === "ollama" ? config.ollamaModel : config.qwenModel,
      installedModels: [],
      error: (error as Error).message,
    };
  }
});
