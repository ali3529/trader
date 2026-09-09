import { defineHandler } from "nitro";
import { readBody } from "nitro/h3";
import { saveRunnerConfig } from "../../../utils/botRunner";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { DEFAULT_CONFIG, DEFAULT_SYMBOLS, MAX_WATCH_SYMBOLS, normalizeConfig } from "../../../../src/lib/config";
import type { StrategyConfig } from "../../../../src/lib/config";

interface Body {
  cfg?: Partial<StrategyConfig>;
  symbols?: string[];
}

/** دریافت تنظیمات استراتژی و لیست پایش از UI برای رانر ۲۴/۷ سرور */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = (await readBody<Body>(event)) ?? {};
  const cfg = normalizeConfig({ ...DEFAULT_CONFIG, ...(body.cfg ?? {}) } as StrategyConfig);
  const symbols =
    Array.isArray(body.symbols) && body.symbols.length
      ? body.symbols.map((s) => String(s).toUpperCase()).slice(0, MAX_WATCH_SYMBOLS)
      : [...DEFAULT_SYMBOLS];
  await saveRunnerConfig(cfg, symbols);
  return { ok: true, symbols };
});
