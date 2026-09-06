import { defineHandler } from "nitro";
import { listOllamaModels, ollamaConfig } from "../../../utils/ollama";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  const config = ollamaConfig();
  try {
    const models = await listOllamaModels(config);
    return {
      reachable: true,
      ready: models.includes(config.model),
      model: config.model,
      installedModels: models,
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      model: config.model,
      installedModels: [],
      error: (error as Error).message,
    };
  }
});
