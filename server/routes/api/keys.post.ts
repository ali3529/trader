import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { saveKeys } from "../../utils/nobitex";

interface Body {
  apiKey?: string;
  apiSecret?: string;
  sandbox?: boolean;
  enableReal?: boolean;
  confirm?: string;
}

/**
 * ذخیره کلیدهای API به‌صورت رمزنگاری‌شده.
 * فعال‌سازی معامله واقعی نیازمند تأیید روشن (confirm === "ENABLE-REAL-TRADING") است.
 */
export default defineHandler(async (event) => {
  const body = await readBody<Body>(event);
  const apiKey = (body?.apiKey ?? "").trim();
  const apiSecret = (body?.apiSecret ?? "").trim();
  if (!apiKey || !apiSecret) {
    throw createError({ statusCode: 400, statusMessage: "apiKey و apiSecret الزامی است" });
  }
  const enableReal = body?.enableReal === true;
  if (enableReal && body?.confirm !== "ENABLE-REAL-TRADING") {
    throw createError({ statusCode: 400, statusMessage: "فعال‌سازی معامله واقعی نیازمند تأیید روشن کاربر است" });
  }
  saveKeys({ apiKey, apiSecret, sandbox: body?.sandbox === true, realEnabled: enableReal });
  return { ok: true, realEnabled: enableReal };
});
