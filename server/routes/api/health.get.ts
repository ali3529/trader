import { defineHandler } from "nitro";
import { STATE_BACKEND } from "../../utils/stateStore";

/** بررسی زنده‌بودن لایه سرور و تشخیص اینکه کدام build روی دامنه اجراست */
export default defineHandler(() => ({
  ok: true,
  build: process.env.VERCEL_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  storage: STATE_BACKEND,
  time: new Date().toISOString(),
}));
