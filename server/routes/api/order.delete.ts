import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { privateRequest, loadKeys } from "../../utils/nobitex";

/**
 * لغو سفارش — طبق مستندات رسمی نوبیتکس:
 * DELETE /api/orders/{order-id} (شناسه عددی سفارش در مسیر؛ بدون بدنه)
 * پاسخ موفق: { status: "OK" }
 */
export default defineHandler(async (event) => {
  const keys = loadKeys();
  if (!keys || !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
  }
  const body = await readBody<{ id?: string | number }>(event);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: "شناسه سفارش نامعتبر" });
  await privateRequest("DELETE", `/orders/${id}`);
  return { ok: true };
});
