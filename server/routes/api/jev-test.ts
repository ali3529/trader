import { defineEventHandler, createError } from "h3";
import { loadAiConfig, analyzeWithJev, hasJevToken } from "../../utils/jev";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

/**
 * مسیر تست سریع Jev — با تنظیمات ذخیره‌شده کاربر کار می‌کند تا خطای توکن
 * یا baseURL قبل از فعال‌کردن گیت AI در رانر مشخص شود.
 */
export default defineEventHandler(async (event) => {
  // The test still spends the configured Jev token; protect it like other
  // sensitive AI routes.
  assertSensitiveRequest(event);
  let config;
  try {
    config = await loadAiConfig();
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: (error as Error).message });
  }
  if (!hasJevToken(config.jevToken)) {
    throw createError({ statusCode: 400, statusMessage: "توکن Jev ذخیره نشده است" });
  }
  if (config.provider !== "jev") {
    throw createError({ statusCode: 400, statusMessage: "ارائه‌دهندهٔ فعال Jev نیست" });
  }
  return analyzeWithJev(
    config,
    {
      symbol: "BTCIRT",
      price: 100_000_000,
      changePct24h: 1.2,
      volume24h: 500_000_000,
      signal: { qualified: true, score: 7, pattern: "hammer" },
    },
  );
});
