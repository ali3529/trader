import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadTelegramConfig, maskToken } from "../../../utils/telegram";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  const cfg = await loadTelegramConfig();
  return {
    configured: Boolean(cfg.botToken && cfg.chatId),
    maskedToken: maskToken(cfg.botToken),
    chatId: cfg.chatId,
    enabled: cfg.enabled,
    notifySignals: cfg.notifySignals,
    notifyPositions: cfg.notifyPositions,
    notifyDigest: cfg.notifyDigest,
  };
});
