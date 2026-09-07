import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { privateRequest, loadKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { getExchangeProvider } from "../../utils/exchangePrefs";
import { cancelOrder as ramzinexCancel, loadRamzinexKeys } from "../../utils/ramzinex";

/**
 * لغو سفارش — طبق مستندات رسمی نوبیتکس:
 * POST /market/orders/update-status با status=canceled.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const keys = await loadKeys();
  if (!keys || !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
  }
  const body = await readBody<{ id?: string | number }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: "شناسه سفارش نامعتبر" });
  if ((await getExchangeProvider()) === "ramzinex") {
    const rzKeys = await loadRamzinexKeys();
    if (!rzKeys?.realEnabled) throw createError({ statusCode: 403, statusMessage: "معامله واقعی رمزینکس فعال نیست" });
    await ramzinexCancel(id);
    return { ok: true };
  }
  await privateRequest("POST", "/market/orders/update-status", {
    body: { order: id, status: "canceled" },
    retryable: true,
  });
  return { ok: true };
});
