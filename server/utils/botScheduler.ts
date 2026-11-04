import { runnerTick } from "./botRunner";

/**
 * زمان‌بند داخلی فقط برای سرورهای ماندگار (dev/VPS/Node).
 * در serverless چرخهٔ عمر پردازش تضمین‌شده نیست و vercel.json یا پینگر خارجی
 * باید /api/cron/tick را فراخوانی کند.
 */
const SERVERLESS = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_PAGES,
);
const DISABLED = String(process.env.TRADEBAN_DISABLE_INTERNAL_SCHEDULER ?? "").toLowerCase() === "true";
const INTERVAL_MS = 10 * 60_000;

let interval: ReturnType<typeof setInterval> | null = null;
let startup: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

async function runScheduledTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runnerTick();
  } catch (error) {
    console.error(`[bot-scheduler] tick failed: ${(error as Error).message}`);
  } finally {
    inFlight = false;
  }
}

export function internalSchedulerEnabled(): boolean {
  return !SERVERLESS && !DISABLED;
}

export function startBotScheduler(): void {
  if (!internalSchedulerEnabled() || interval) return;
  // پس از بالا آمدن سرور، state قبلی فوراً بررسی می‌شود؛ اگر running=false باشد
  // runnerTick بدون تماس با صرافی برمی‌گردد.
  startup = setTimeout(() => void runScheduledTick(), 1_000);
  startup.unref?.();
  interval = setInterval(() => void runScheduledTick(), INTERVAL_MS);
  interval.unref?.();
  console.info("[bot-scheduler] internal 10-minute runner enabled");
}

/** پس از روشن‌کردن رانر، برای اولین tick منتظر چرخهٔ بعدی نمی‌مانیم. */
export function triggerBotTick(): void {
  if (!internalSchedulerEnabled()) return;
  setTimeout(() => void runScheduledTick(), 0).unref?.();
}

export function stopBotScheduler(): void {
  if (startup) clearTimeout(startup);
  if (interval) clearInterval(interval);
  startup = null;
  interval = null;
}
