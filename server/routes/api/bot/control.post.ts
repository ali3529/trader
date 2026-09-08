import { defineHandler } from "nitro";
import { readBody } from "nitro/h3";
import { loadRunnerState, resetRunner, runnerStatus, setRunnerRunning } from "../../../utils/botRunner";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

interface Body {
  running?: boolean;
  reset?: boolean;
}

/** روشن/خاموش کردن و بازنشانی رانر ۲۴/۷ (فقط کاغذی) */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = (await readBody<Body>(event)) ?? {};

  if (body.reset === true) {
    await setRunnerRunning(false);
    await resetRunner();
    return runnerStatus();
  }

  if (typeof body.running === "boolean") {
    const state = await loadRunnerState();
    if (body.running === state.running) return runnerStatus();
    await setRunnerRunning(body.running);
  }

  return runnerStatus();
});
