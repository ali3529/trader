import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { getExchangeProvider } from "../../utils/exchangePrefs";
import { loadKeys } from "../../utils/nobitex";
import { loadRamzinexKeys } from "../../utils/ramzinex";
import { getBotMode, setBotMode, type BotMode } from "../../utils/botMode";
import { setRunnerRunning } from "../../utils/botRunner";

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
  const currentMode = await getBotMode();
  if (currentMode !== mode) {
    // تغییر Paper/Real هرگز یک رانر فعال را بی‌صدا به دفتر دیگر منتقل نمی‌کند.
    // کاربر پس از تغییر حالت، رانر سرور را صریحاً دوباره روشن می‌کند.
    await setRunnerRunning(false, currentMode);
  }
  await setBotMode(mode as BotMode);
  return { ok: true, mode, runnerStopped: currentMode !== mode };
});
