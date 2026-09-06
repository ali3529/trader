import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { analyzeWithQwen, ollamaConfig } from "../../../utils/ollama";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

interface AnalysisRequest {
  symbol?: string;
  price?: number;
  changePct24h?: number;
  volume24h?: number;
  signal?: {
    qualified?: boolean;
    score?: number;
    rr?: number;
    entry?: number;
    stop?: number;
    target?: number;
    pattern?: string | null;
    volumeRatio?: number;
    criteria?: Array<{ label?: string; passed?: boolean; critical?: boolean; detail?: string }>;
  };
}

export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<AnalysisRequest>(event);
  if (!body?.symbol || !/^[A-Z]{2,12}IRT$/.test(body.symbol) || !body.signal) {
    throw createError({ statusCode: 400, statusMessage: "داده سیگنال معتبر نیست" });
  }
  const snapshot = {
    symbol: body.symbol,
    price: finite(body.price),
    changePct24h: finite(body.changePct24h),
    volume24h: finite(body.volume24h),
    signal: {
      qualified: body.signal.qualified === true,
      score: finite(body.signal.score),
      rr: finite(body.signal.rr),
      entry: finite(body.signal.entry),
      stop: finite(body.signal.stop),
      target: finite(body.signal.target),
      pattern: String(body.signal.pattern ?? "none").slice(0, 60),
      volumeRatio: finite(body.signal.volumeRatio),
      criteria: (body.signal.criteria ?? []).slice(0, 8).map((item) => ({
        label: String(item.label ?? "").slice(0, 100),
        passed: item.passed === true,
        critical: item.critical === true,
        detail: String(item.detail ?? "").slice(0, 220),
      })),
    },
  };
  try {
    return await analyzeWithQwen(
      ollamaConfig(),
      snapshot,
    );
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: `تحلیل Qwen در دسترس نیست: ${(error as Error).message}`,
    });
  }
});

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
