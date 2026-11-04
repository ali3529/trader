import { defineHandler } from "nitro";
import { readBody } from "nitro/h3";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { submitRealOrder, type OrderBody } from "../../utils/orderExecution";

/**
 * ثبت سفارش اسپات طبق مستندات فعلی صرافی فعال (نوبیتکس/رمزینکس).
 * فقط اگر معامله واقعی با تأیید روشن کاربر (ENABLE-REAL-TRADING) فعال شده باشد.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<OrderBody>(event);
  return submitRealOrder(body);
});
