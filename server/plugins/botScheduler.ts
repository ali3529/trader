import { definePlugin } from "nitro";
import { startBotScheduler, stopBotScheduler } from "../utils/botScheduler";

/** چرخهٔ مستقل از مرورگر برای اجرای محلی یا روی VPS/Node ماندگار. */
export default definePlugin((nitroApp) => {
  startBotScheduler();
  nitroApp.hooks.hook("close", () => stopBotScheduler());
});
