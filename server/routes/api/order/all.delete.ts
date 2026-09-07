import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { privateRequest, loadKeys } from "../../../utils/nobitex";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { getExchangeProvider } from "../../../utils/exchangePrefs";
import {
  cancelAllOrders as rzCancelAll,
  fetchOpenOrders as rzOpenOrders,
  loadRamzinexKeys,
} from "../../../utils/ramzinex";

/**
 * لغو همهٔ سفارش‌های باز:
 * - رمزینکس: عملیات cancelAllOrdersId (لغو تمامی سفارشات هر بازار) با fallback به لغو تکی
 * - نوبیتکس: POST /market/orders/update-status برای هر شناسه
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<{ ids?: Array<number | string>; symbols?: string[] }>(event);

  if ((await getExchangeProvider()) === "ramzinex") {
    const rzKeys = await loadRamzinexKeys();
    if (!rzKeys?.realEnabled) throw createError({ statusCode: 403, statusMessage: "معامله واقعی رمزینکس فعال نیست" });
    let symbols = Array.from(
      new Set((body?.symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean)),
    );
    if (!symbols.length) {
      const rows = await rzOpenOrders();
      symbols = Array.from(
        new Set(
          rows
            .map((row) => String((row as Record<string, unknown>).symbol ?? "").trim().toUpperCase())
            .filter(Boolean),
        ),
      );
    }
    let canceled = 0;
    for (const symbol of symbols) {
      const count = await rzCancelAll(symbol);
      if (count > 0) canceled += count;
    }
    return { ok: true, canceled: canceled || null };
  }

  const keys = await loadKeys();
  if (!keys || !keys.realEnabled) throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
  const ids = (body?.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: "سفارش بازی برای لغو وجود ندارد" });
  for (const id of ids) {
    await privateRequest("POST", "/market/orders/update-status", {
      body: { order: id, status: "canceled" },
      retryable: true,
    });
  }
  return { ok: true, canceled: ids.length };
});
