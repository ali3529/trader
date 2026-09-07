import { defineHandler } from "nitro";
import { deleteKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

/** حذف کلیدهای ذخیره‌شده از سرور */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  await deleteKeys();
  return { ok: true };
});
