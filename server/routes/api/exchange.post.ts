import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getExchangeProvider, setExchangeProvider, type ExchangeProvider } from "../../utils/exchangePrefs";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

/** تغییر صرافی فعال — نوبیتکس یا رمزینکس */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<{ provider?: string }>(event);
  const provider = String(body?.provider ?? "").toLowerCase();
  if (provider !== "nobitex" && provider !== "ramzinex") {
    throw createError({ statusCode: 400, statusMessage: "صرافی معتبر نیست (nobitex یا ramzinex)" });
  }
  setExchangeProvider(provider as ExchangeProvider);
  return { ok: true, provider: getExchangeProvider() };
});
