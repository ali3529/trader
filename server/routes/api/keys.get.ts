import { defineHandler } from "nitro";
import { decodePrivateKey, loadKeys } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";

/** وضعیت کلیدها — هیچ بخشی از secret برنمی‌گردد */
export default defineHandler((event) => {
  assertSensitiveRequest(event);
  const keys = loadKeys();
  if (!keys) return { configured: false, needsUpgrade: false, realEnabled: false, sandbox: false, maskedKey: null };
  let valid = true;
  try {
    decodePrivateKey(keys.apiSecret);
  } catch {
    valid = false;
  }
  return {
    configured: valid,
    needsUpgrade: !valid,
    realEnabled: valid && keys.realEnabled,
    sandbox: keys.sandbox,
    maskedKey: `${keys.apiKey.slice(0, 4)}****${keys.apiKey.slice(-4)}`,
  };
});
