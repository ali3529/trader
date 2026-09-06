import { defineHandler } from "nitro";
import { deleteKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

/** حذف کلیدهای ذخیره‌شده از سرور */
export default defineHandler((event) => {
  assertSensitiveRequest(event, { mutation: true });
  deleteKeys();
  return { ok: true };
});
