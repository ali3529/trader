import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { exchangeRealEnabled, loadRunnerState, resetRunner, runnerStatus, setRunnerRunning } from "../../../utils/botRunner";
import { getBotMode, setBotMode, type BotMode } from "../../../utils/botMode";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { triggerBotTick } from "../../../utils/botScheduler";

interface Body {
  running?: boolean;
  reset?: boolean;
  mode?: BotMode;
}

/** روشن/خاموش کردن رانر ۲۴/۷؛ حالت Real فقط با گیت صریح کلیدها پذیرفته می‌شود. */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = (await readBody<Body>(event)) ?? {};
  const currentMode = await getBotMode();
  const requestedMode = body.mode ?? currentMode;
  if (requestedMode !== "paper" && requestedMode !== "real") {
    throw createError({ statusCode: 400, statusMessage: "حالت رانر نامعتبر است" });
  }

  if (body.reset === true) {
    if (currentMode === "real") {
      throw createError({ statusCode: 409, statusMessage: "دفتر Real قابل بازنشانی نیست؛ ابتدا حالت Paper را انتخاب کنید" });
    }
    await setRunnerRunning(false, "paper");
    await resetRunner("paper");
    return runnerStatus();
  }

  if (typeof body.running === "boolean") {
    if (body.running && requestedMode === "real" && !(await exchangeRealEnabled())) {
      throw createError({
        statusCode: 403,
        statusMessage: "برای اجرای Real روی سرور، ابتدا کلید صرافی و ENABLE-REAL-TRADING را فعال کنید",
      });
    }
    if (body.running && requestedMode !== currentMode) await setBotMode(requestedMode);
    const state = await loadRunnerState(requestedMode);
    if (body.running === state.running) return runnerStatus();
    await setRunnerRunning(body.running, requestedMode);
    if (body.running) triggerBotTick();
  }

  return runnerStatus();
});
