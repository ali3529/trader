import { loadAiConfig, analyzeWithJev, hasJevToken, type AiConfig, type JevAnalysis } from "./jev";
import type { EntrySignal, SymbolScan } from "../../src/lib/types";

/**
 * گیت تصمیم‌گیری AI برای ورود به پوزیشن.
 *
 * Jev هرگز به‌تنهایی پوزیشن باز نمی‌کند — فقط یک قضاوت مشوره است. تصمیم
 * نهایی با ترکیب قضاوت Jev، پیکربندی کاربر و سقف‌های ریسک پورتفو گرفته
 * می‌شود. در هر ابهام یا خطا، گیت fail-closed است: ورود انجام نمی‌شود.
 *
 * ترتیب تصمیم:
 *   ۱) اگر AI غیرفعال است → ورود مجاز است (استراتژی خالص تصمیم می‌گیرد)
 *   ۲) اگر AI فعال ولی توکن نیست → ورود مسدود (fail-closed)
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
  aiMinDecision: 0.6,
  aiMaxRiskScore: 3,
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
  if (actionLabel === "Wait") {
    return { pass: false, sizeFraction: 0, reason: "AI: انتظار" };
  }
  if (analysis.decision < gate.aiMinDecision) {
    return {
      pass: false,
      sizeFraction: 0,
      reason: `AI: تصمیم ضعیف (${(analysis.decision * 100).toFixed(0)}٪)`,
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
 * در خطای ارتباطی با Jev، ورود fail-closed مسدود می‌شود.
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
      allowed: false,
      sizeFraction: 0,
      analysis: null,
      reason: `خطا در خواندن تنظیمات AI: ${(error as Error).message}`,
    };
  }

  if (config.provider !== "jev" || !hasJevToken(config.jevToken)) {
    return {
      allowed: false,
      sizeFraction: 0,
      analysis: null,
      reason: "گیت AI فعال است ولی Jev پیکربندی نشده — تنظیمات → تحلیلگر AI",
    };
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
      allowed: false,
      sizeFraction: 0,
      analysis: null,
      reason: `خطای Jev: ${(error as Error).message}`,
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
