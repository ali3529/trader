import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { RamzinexError, fetchAccount, getPrivateToken, loadRamzinexKeys, saveRamzinexKeys } from "../../../utils/ramzinex";

interface Body {
  apiKey?: string;
  secret?: string;
  enableReal?: boolean;
  confirm?: string;
}

/**
 * ذخیره رمزنگاری‌شده کلیدهای رمزینکس (API-Key + Secret).
 * فعال‌سازی معامله واقعی نیازمند تأیید روشن (ENABLE-REAL-TRADING) است و
 * با دریافت توکن + خواندن دارایی‌ها اعتبارسنجی می‌شود؛ خطای شبکه فعال‌سازی محلی را نمی‌بندد.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<Body>(event);
  const current = await loadRamzinexKeys();
  const apiKey = (body?.apiKey ?? "").trim() || current?.apiKey || "";
  const secret = (body?.secret ?? "").trim() || current?.secret || "";
  if (!apiKey || !secret) {
    throw createError({ statusCode: 400, statusMessage: "API-Key و Secret رمزینکس الزامی است" });
  }
  const enableReal = body?.enableReal === true;
  if (enableReal && body?.confirm !== "ENABLE-REAL-TRADING") {
    throw createError({ statusCode: 400, statusMessage: "فعال‌سازی معامله واقعی نیازمند تأیید روشن کاربر است" });
  }
  let warning: string | null = null;
  if (enableReal) {
    try {
      await getPrivateToken(true);
      await fetchAccount();
    } catch (error) {
      const status = error instanceof RamzinexError ? error.statusCode : 0;
      if (status === 400 || status === 401 || status === 403) {
        throw createError({ statusCode: 401, statusMessage: `اتصال رمزینکس تأیید نشد: ${(error as Error).message}` });
      }
      warning = `معامله واقعی رمزینکس فعال شد ولی اکنون در دسترس نیست؛ تا بازگشت اتصال هیچ سفارشی ارسال نمی‌شود. (${(error as Error).message})`;
    }
  }
  const realEnabled = body?.enableReal === undefined ? current?.realEnabled === true : enableReal;
  await saveRamzinexKeys({ apiKey, secret, realEnabled });
  return { ok: true, realEnabled, warning };
});
