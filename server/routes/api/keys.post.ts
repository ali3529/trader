import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { decodePrivateKey, saveKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

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
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<Body>(event);
  const apiKey = (body?.apiKey ?? "").trim();
  const apiSecret = (body?.apiSecret ?? "").trim();
  if (!apiKey || !apiSecret) {
    throw createError({ statusCode: 400, statusMessage: "API Key و Ed25519 Private Key الزامی است" });
  }
  try {
    decodePrivateKey(apiSecret);
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message });
  }
  const enableReal = body?.enableReal === true;
  if (enableReal && body?.confirm !== "ENABLE-REAL-TRADING") {
    throw createError({ statusCode: 400, statusMessage: "فعال‌سازی معامله واقعی نیازمند تأیید روشن کاربر است" });
  }
  await saveKeys({ apiKey, apiSecret, sandbox: body?.sandbox === true, realEnabled: enableReal });
  return { ok: true, realEnabled: enableReal };
});
