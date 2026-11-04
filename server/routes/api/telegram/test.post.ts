import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { loadTelegramConfig, sendTelegram } from "../../../utils/telegram";

export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const config = await loadTelegramConfig();
  const result = await sendTelegram(
    [
      "✅ <b>تست تلگرام تریدبان موفق بود</b>",
      config.enabled
        ? "اعلان‌های خودکار فعال‌اند و پیام‌های انتخاب‌شده به این گفتگو ارسال می‌شوند."
        : "اتصال ربات برقرار است؛ اعلان‌های خودکار هنوز غیرفعال‌اند. برای دریافت سیگنال‌ها و گزارش‌ها، سوییچ اصلی را روشن و تنظیمات را ذخیره کنید.",
    ].join("\n"),
    { allowWhenDisabled: true },
  );
  return result;
});
