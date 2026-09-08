import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  // روی Vercel خروجی باید .vercel/output باشد؛ صریح می‌گذاریم تا به تشخیص خودکار وابسته نباشیم
  preset: process.env.VERCEL ? "vercel" : undefined,
  routeRules: {
    // tick رانر ۲۴/۷ چندین درخواست کندل پشت‌سرهم می‌زند (رمزینکس ~2s throttle)
    "/api/cron/tick": { vercel: { maxDuration: 60 } },
  },
});
