import { defineHandler } from "nitro";
import { deleteKeys } from "../../utils/nobitex";

/** حذف کلیدهای ذخیره‌شده از سرور */
export default defineHandler(() => {
  deleteKeys();
  return { ok: true };
});
