import { defineHandler } from "nitro";
import { loadRamzinexKeys } from "../../../utils/ramzinex";

/** وضعیت کلیدهای رمزینکس بدون افشای مقدار — فقط ماسک‌شده */
export default defineHandler(async () => {
  const keys = await loadRamzinexKeys();
  if (!keys) return { configured: false, maskedKey: null, realEnabled: false };
  return {
    configured: true,
    maskedKey: `••••${keys.apiKey.slice(-4)}`,
    realEnabled: keys.realEnabled === true,
  };
});
