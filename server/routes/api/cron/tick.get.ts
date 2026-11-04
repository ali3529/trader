import { createHash, timingSafeEqual } from "node:crypto";
import { defineHandler } from "nitro";
import { getRequestHeader } from "nitro/h3";
import { runnerTick } from "../../../utils/botRunner";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

function safeEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * نقطهٔ tick کرون ۲۴/۷.
 * - Vercel Cron با هدر `Authorization: Bearer $CRON_SECRET` صدا می‌زند.
 * - پینگر خارجی (مثل cron-job.org روی پلن Hobby) می‌تواند همان Bearer یا
 *   احراز هویت Basic (TRADEBAN_BASIC_AUTH) را بفرستد.
 * - بدون CRON_SECRET، فقط مسیر Basic/محلی مجاز است.
 */
export default defineHandler(async (event) => {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  const auth = getRequestHeader(event, "authorization") ?? "";
  if (secret && safeEqual(auth, `Bearer ${secret}`)) {
    return runnerTick();
  }
  assertSensitiveRequest(event);
  return runnerTick();
});
