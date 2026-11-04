import {
  defineEventHandler,
  readBody,
  createError
} from "h3";


import {
  loadAiConfig,
  analyzeWithJev,
  hasJevToken
} from "../../../utils/jev";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

/**
 * تحلیل مشورهٔ یک فرصت با Jev. این مسیر فقط قضاوت می‌کند و هیچ سفارشی
 * صادر نمی‌کند — تصمیم نهایی ورود در رانر (aiGate) گرفته می‌شود.
 */
export default defineEventHandler(async (event) => {
  // This route spends the server-side Jev token and must never be public.
  assertSensitiveRequest(event);
  const body = await readBody(event);
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, statusMessage: "بدنهٔ درخواست نامعتبر است" });
  }

  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const price = Number(body.price);
  const changePct24h = Number(body.changePct24h);
  const volume24h = Number(body.volume24h);
  if (!/^[A-Z0-9]{3,24}$/.test(symbol) || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(changePct24h) || !Number.isFinite(volume24h) || volume24h < 0) {
    throw createError({ statusCode: 400, statusMessage: "snapshot معامله نامعتبر است" });
  }
  const signal: unknown = body.signal;
  try {
    if (JSON.stringify(signal ?? null).length > 12_000) {
      throw new Error("snapshot too large");
    }
  } catch {
    throw createError({ statusCode: 400, statusMessage: "snapshot معامله نامعتبر است" });
  }

  let config;
  try {
    config = await loadAiConfig();
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: (error as Error).message });
  }
  if (config.provider !== "jev" || !hasJevToken(config.jevToken)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Jev پیکربندی نشده است — ابتدا توکن را در تنظیمات ذخیره کنید",
    });
  }

  const analysis = await analyzeWithJev(config, {
    symbol,
    price,
    changePct24h,
    volume24h,
    signal,
  });

  return analysis;
});
