import { defineHandler } from "nitro";
import { readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadTelegramConfig, maskToken, saveTelegramConfig } from "../../../utils/telegram";

interface Body {
  botToken?: string;
  chatId?: string;
  enabled?: boolean;
  notifySignals?: boolean;
  notifyPositions?: boolean;
  notifyDigest?: boolean;
}

export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = (await readBody<Body>(event)) ?? {};
  const next = await saveTelegramConfig({
    ...(typeof body.botToken === "string" ? { botToken: body.botToken.trim() } : {}),
    ...(typeof body.chatId === "string" ? { chatId: body.chatId.trim() } : {}),
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(typeof body.notifySignals === "boolean" ? { notifySignals: body.notifySignals } : {}),
    ...(typeof body.notifyPositions === "boolean" ? { notifyPositions: body.notifyPositions } : {}),
    ...(typeof body.notifyDigest === "boolean" ? { notifyDigest: body.notifyDigest } : {}),
  });
  return {
    ok: true,
    configured: Boolean(next.botToken && next.chatId),
    maskedToken: maskToken(next.botToken),
    chatId: next.chatId,
    enabled: next.enabled,
    notifySignals: next.notifySignals,
    notifyPositions: next.notifyPositions,
    notifyDigest: next.notifyDigest,
  };
});
