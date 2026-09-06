import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { decodePrivateKey, loadKeys, privateRequest, saveKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

interface Body {
  enable?: boolean;
  confirm?: string;
}

/** فعال/غیرفعال‌سازی معامله واقعی — نیازمند تأیید روشن کاربر */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<Body>(event);
  const keys = loadKeys();
  if (!keys) throw createError({ statusCode: 400, statusMessage: "ابتدا کلیدهای API را ذخیره کنید" });
  try {
    decodePrivateKey(keys.apiSecret);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "کلید قدیمی است؛ API Key و Ed25519 Private Key جدید را ذخیره کنید" });
  }
  const enable = body?.enable === true;
  if (enable && body?.confirm !== "ENABLE-REAL-TRADING") {
    throw createError({ statusCode: 400, statusMessage: "فعال‌سازی معامله واقعی نیازمند تأیید روشن کاربر است" });
  }
  if (enable) {
    try {
      await privateRequest("GET", "/users/profile");
    } catch (error) {
      throw createError({ statusCode: 401, statusMessage: `اتصال نوبیتکس تأیید نشد: ${(error as Error).message}` });
    }
  }
  saveKeys({ ...keys, realEnabled: enable });
  return { ok: true, realEnabled: enable };
});
