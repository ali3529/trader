import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { loadKeys, saveKeys } from "../../utils/nobitex";

interface Body {
  enable?: boolean;
  confirm?: string;
}

/** فعال/غیرفعال‌سازی معامله واقعی — نیازمند تأیید روشن کاربر */
export default defineHandler(async (event) => {
  const body = await readBody<Body>(event);
  const keys = loadKeys();
  if (!keys) throw createError({ statusCode: 400, statusMessage: "ابتدا کلیدهای API را ذخیره کنید" });
  const enable = body?.enable === true;
  if (enable && body?.confirm !== "ENABLE-REAL-TRADING") {
    throw createError({ statusCode: 400, statusMessage: "فعال‌سازی معامله واقعی نیازمند تأیید روشن کاربر است" });
  }
  saveKeys({ ...keys, realEnabled: enable });
  return { ok: true, realEnabled: enable };
});
