import { defineHandler } from "nitro";

/** بررسی زنده‌بودن لایه سرور و تشخیص اینکه کدام build روی دامنه اجراست */
export default defineHandler(() => ({
  ok: true,
  build: process.env.VERCEL_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  time: new Date().toISOString(),
}));
