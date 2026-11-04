import { defineHandler } from "nitro";
import { readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import {
  formatClose,
  formatDigest,
  formatOpen,
  formatSignal,
  loadTelegramConfig,
  sendTelegram,
  type ClosePayload,
  type DigestPayload,
  type OpenPayload,
  type SignalPayload,
} from "../../../utils/telegram";

type NotifyBody =
  | { kind: "signal"; data: SignalPayload }
  | { kind: "open"; data: OpenPayload }
  | { kind: "close"; data: ClosePayload }
  | { kind: "digest"; data: DigestPayload };

/** رویدادهای موتور (کلاینت یا رانر سرور) → پیام تلگرام */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const cfg = await loadTelegramConfig();
  if (!cfg.enabled) return { ok: false, skipped: "disabled" };
  const body = (await readBody<NotifyBody>(event)) ?? ({} as NotifyBody);
  let text: string | null = null;
  if (body.kind === "signal" && cfg.notifySignals) text = formatSignal(body.data);
  else if ((body.kind === "open" || body.kind === "close") && cfg.notifyPositions) {
    text = body.kind === "open" ? formatOpen(body.data) : formatClose(body.data);
  } else if (body.kind === "digest" && cfg.notifyDigest) text = formatDigest(body.data);
  if (!text) return { ok: false, skipped: "filtered" };
  const result = await sendTelegram(text);
  return result;
});
