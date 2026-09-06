import { defineHandler } from "nitro";
import { loadKeys } from "../../utils/nobitex";

/** وضعیت کلیدها — هیچ بخشی از secret برنمی‌گردد */
export default defineHandler(() => {
  const keys = loadKeys();
  if (!keys) return { configured: false, realEnabled: false, sandbox: false, maskedKey: null };
  return {
    configured: true,
    realEnabled: keys.realEnabled,
    sandbox: keys.sandbox,
    maskedKey: `${keys.apiKey.slice(0, 4)}****${keys.apiKey.slice(-4)}`,
  };
});
