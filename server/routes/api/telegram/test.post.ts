import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { sendTelegram } from "../../../utils/telegram";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const result = await sendTelegram(
    "✅ <b>تست تلگرام تریدبان</b>\nاتصال ربات برقرار است؛ از این پس فرصت‌ها، پوزیشن‌ها و گزارش‌ها اینجا ارسال می‌شوند.",
  );
  return result;
});
