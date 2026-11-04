import { loadAiConfig, analyzeWithJev, hasJevToken, type AiConfig, type JevAnalysis } from "./jev";
import type { EntrySignal, SymbolScan } from "../../src/lib/types";

/**
 * گیت تصمیم‌گیری AI برای ورود به پوزیشن.
 *
 * Jev هرگز به‌تنهایی پوزیشن باز نمی‌کند — فقط یک قضاوت مشوره است. تصمیم
 * نهایی با ترکیب قضاوت Jev، پیکربندی کاربر و سقف‌های ریسک پورتفو گرفته
 * می‌شود. در خطا یا نبود Jev گیت fail-open است (سایز کاهش‌یافته)؛ فقط رد صریح یا ریسک بسیار بالا مسدود می‌کند.
 *
 * ترتیب تصمیم:
 *   ۱) اگر AI غیرفعال است → ورود مجاز است (استراتژی خالص تصمیم می‌گیرد)
 *   ۲) اگر AI فعال ولی توکن نیست → ورود بدون گیت
 *   ۳) قضاوت Jev → رد/کاهش سایز/تأیید
 */

export interface AiGateConfig {
  /** کل گیت AI روشن است؟ */
  aiGateEnabled: boolean;
  /** حداقل noul (۰ تا ۱) مورد نیاز برای ورود */
  aiMinDecision: number;
  /** امتیاز ریسک (۰ تا ۴) در این حد و بالاتر → ورود مسدود */
  aiMaxRiskScore: number;
  /** در صورت تأیید، سایز پوزیشن این ضریب می‌شود */
  aiReduceFraction: number;
}

export const DEFAULT_AI_GATE: AiGateConfig = {
  aiGateEnabled: true,
  aiMinDecision: 0.45,
  aiMaxRiskScore: 4,
  aiReduceFraction: 0.5,
};

export interface AiGateInput {
  symbol: string;
  signal: EntrySignal;
  scan: SymbolScan;
}

export type AiGateVerdict =
  | { allowed: true; sizeFraction: number; analysis: JevAnalysis | null; reason: string }
  | { allowed: false; sizeFraction: 0; analysis: JevAnalysis | null; reason: string };

/** قضاوت Jev به یک تصمیم قابل‌فهم تبدیل می‌شود */
export function interpretJev(
  analysis: JevAnalysis,
  gate: AiGateConfig,
): { pass: boolean; sizeFraction: number; reason: string } {
  const actionLabel = String(analysis.action.legend[Math.round(analysis.action.score)] ?? "");
  const riskScore = analysis.risk.score;

  if (riskScore >= gate.aiMaxRiskScore) {
    return {
      pass: false,
      sizeFraction: 0,
      reason: `AI: ریسک بالا (${analysis.risk.label || riskScore.toFixed(1)})`,
    };
  }
  if (actionLabel === "Reject") {
    return { pass: false, sizeFraction: 0, reason: "AI: رد معامله" };
  }
  // حالت تهاجمی: «انتظار» یا تصمیم ضعیف فقط سایز را کم می‌کند، ورود را مسدود نمی‌کند.
  if (actionLabel === "Wait" || analysis.decision < gate.aiMinDecision) {
    return {
      pass: true,
      sizeFraction: gate.aiReduceFraction,
      reason: actionLabel === "Wait"
        ? `AI: انتظار — ورود با سایز ${(gate.aiReduceFraction * 100).toFixed(0)}٪`
        : `AI: تصمیم ضعیف (${(analysis.decision * 100).toFixed(0)}٪) — سایز کاهش یافت`,
    };
  }
  if (actionLabel === "Reduce position") {
    return {
      pass: true,
      sizeFraction: gate.aiReduceFraction,
      reason: `AI: تأیید با سایز کاهش‌یافته (${(gate.aiReduceFraction * 100).toFixed(0)}٪)`,
    };
  }
  return { pass: true, sizeFraction: 1, reason: "AI: تأیید شد" };
}

/**
 * گیت کامل AI: تنظیمات + قضاوت Jev + تفسیر.
 * در خطای ارتباطی با Jev، ورود با سایز کاهش‌یافته انجام می‌شود.
 */
export async function evaluateAiGate(
  input: AiGateInput,
  gate: AiGateConfig,
): Promise<AiGateVerdict> {
  if (!gate.aiGateEnabled) {
    return { allowed: true, sizeFraction: 1, analysis: null, reason: "گیت AI غیرفعال است" };
  }

  let config: AiConfig;
  try {
    config = await loadAiConfig();
  } catch (error) {
    return {
      allowed: true,
      sizeFraction: gate.aiReduceFraction,
      analysis: null,
      reason: `AI در دسترس نیست (${(error as Error).message}) — ورود با سایز کاهش‌یافته`,
    };
  }

  if (config.provider !== "jev" || !hasJevToken(config.jevToken)) {
    // Jev پیکربندی نشده: گیت مشاوره‌ای است و استراتژی قطعی بدون آن معامله می‌کند.
    return { allowed: true, sizeFraction: 1, analysis: null, reason: "Jev پیکربندی نشده — ورود بدون گیت AI" };
  }

  let analysis: JevAnalysis;
  try {
    analysis = await analyzeWithJev(config, {
      symbol: input.symbol,
      price: input.scan.lastPrice,
      changePct24h: input.scan.changePct24h,
      volume24h: input.scan.volume24h,
      signal: input.signal,
    });
  } catch (error) {
    return {
      allowed: true,
      sizeFraction: gate.aiReduceFraction,
      analysis: null,
      reason: `خطای Jev (${(error as Error).message}) — ورود با سایز کاهش‌یافته`,
    };
  }

  const verdict = interpretJev(analysis, gate);
  return {
    allowed: verdict.pass,
    sizeFraction: verdict.sizeFraction,
    analysis,
    reason: verdict.reason,
  };
}
