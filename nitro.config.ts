import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  // روی Vercel خروجی باید .vercel/output باشد؛ صریح می‌گذاریم تا به تشخیص خودکار وابسته نباشیم
  preset: process.env.VERCEL ? "vercel" : undefined,
});
