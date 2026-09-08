import { defineHandler } from "nitro";
import { runnerStatus } from "../../../utils/botRunner";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

/** وضعیت رانر ۲۴/۷ سرور برای داشبورد */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  return runnerStatus();
});
