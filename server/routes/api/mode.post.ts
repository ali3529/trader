import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { getExchangeProvider } from "../../utils/exchangePrefs";
import { loadKeys } from "../../utils/nobitex";
import { loadRamzinexKeys } from "../../utils/ramzinex";
import { setBotMode, type BotMode } from "../../utils/botMode";

/**
 * ذخیرهٔ حالت معامله — «real» فقط زمانی پذیرفته می‌شود که دروازهٔ معامله واقعی
 * صرافی فعال (نوبیتکس یا رمزینکس) با تأیید روشن کاربر باز باشد.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<{ mode?: string }>(event);
  const mode = String(body?.mode ?? "");
  if (mode !== "paper" && mode !== "real") {
    throw createError({ statusCode: 400, statusMessage: "حالت نامعتبر است" });
  }
  if (mode === "real") {
    const keys = (await getExchangeProvider()) === "ramzinex" ? await loadRamzinexKeys() : await loadKeys();
    if (!keys || !keys.realEnabled) {
      throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
    }
  }
  await setBotMode(mode as BotMode);
  return { ok: true, mode };
});
