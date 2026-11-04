import type { StrategyConfig } from "../config";
import type { Candle, CriterionResult, EntrySignal } from "../types";
import { lastAtr, lastRsi, volumeRatio } from "./indicators";
import { analyzeStructure, isBullishStructure } from "./structure";
import { detectBullishPatterns, PATTERN_LABELS } from "./patterns";
import {
  allLevels,
  buildGrid,
  exitLevelsAbove,
  levelLower,
  levelUpper,
  nearestSupport,
} from "./levels";

export interface EvaluateInput {
  symbol: string;
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
  cfg: StrategyConfig;
}

/** تصمیم نهایی ورود: همه شروط حیاتی و حداقل امتیاز باید هم‌زمان برقرار باشند. */
export function qualifiesEntry(criteria: CriterionResult[], minConfirmations: number): boolean {
  const score = criteria.filter((criterion) => criterion.passed).length;
  return criteria.every((criterion) => !criterion.critical || criterion.passed) && score >= minConfirmations;
}

/**
 * امتیازدهی ورود با ۸ معیار: پنج شرط حیاتی (ساختار تازه، محل معتبر،
 * تریگر ۱۵ دقیقه، فضای هدف و Stop) و حداقل دو تأیید از سه فیلتر نرم.
 * Grid هرگز معیار ورود نیست — فقط در سیگنال برای تقسیم سرمایه حمل می‌شود.
 */
export function evaluateEntry({ symbol, candles4h, candles1h, candles15m, cfg }: EvaluateInput): EntrySignal | null {
  if (candles4h.length < 40 || candles1h.length < 60 || candles15m.length < 40) return null;

  const atr1h = lastAtr(candles1h, cfg.atrPeriod);
  if (!atr1h || atr1h <= 0) return null;

  const entry = candles1h[candles1h.length - 1].close;
  const time = candles1h[candles1h.length - 1].time;

  // ۱) ساختار ۴ ساعته (حیاتی)
  const structure = analyzeStructure(candles4h, cfg.swingLookback);
  const structureOk = isBullishStructure(structure, candles4h.length - 1, cfg.entryStructureBars);

  // سطوح کلیدی یک‌ساعته
  const levels = allLevels(candles1h, atr1h, cfg);
  const support = nearestSupport(levels, entry);
  const exitLevels = exitLevelsAbove(levels, entry);
  const firstResistance = exitLevels[0] ?? null;

  // ۲) محل معتبر: نزدیکی قیمت به حمایت/Order Block/FVG (حیاتی)
  const distanceToLevel = support ? Math.max(0, entry - levelUpper(support)) : Infinity;
  const locationOk = support !== null && distanceToLevel <= cfg.levelProximityAtr * atr1h;

  // ۳) الگوی تأیید می‌تواند روی یکی از دو کندل اخیر ۱ ساعته شکل گرفته باشد.
  let pattern = null as ReturnType<typeof detectBullishPatterns>[number] | null;
  let patternAge = 0;
  for (let age = 0; age < cfg.entryPatternLookback; age++) {
    const end = candles1h.length - age;
    const hit = detectBullishPatterns(candles1h.slice(0, end), cfg)[0];
    if (hit) {
      pattern = hit;
      patternAge = age;
      break;
    }
  }
  const patternOk = pattern !== null;

  // ۴) تریگر واقعی ۱۵ دقیقه: شکست سقف سه کندل پیشین، در پنجره زمانی محدود.
  const rsi15 = lastRsi(candles15m, cfg.rsiPeriod);
  let triggerAge: number | null = null;
  for (let age = 0; age < cfg.entryTriggerLookback; age++) {
    const index = candles15m.length - 1 - age;
    if (index < 3) break;
    const priorHigh = Math.max(...candles15m.slice(index - 3, index).map((candle) => candle.high));
    if (candles15m[index].close > priorHigh) {
      triggerAge = age;
      break;
    }
  }
  const momentumOk = triggerAge !== null && rsi15 !== null && rsi15 >= cfg.momentumRsiMin && rsi15 <= cfg.momentumRsiMax;

  // ۵) RSI(14) یک‌ساعته در بازه سالم
  const rsi1h = lastRsi(candles1h, cfg.rsiPeriod);
  const rsiOk = rsi1h !== null && rsi1h >= cfg.rsiMin && rsi1h <= cfg.rsiMax;

  // ۶) حجم کندل سیگنال نسبت به میانگین ۱۰ دوره
  const volRatio = volumeRatio(candles1h, cfg.volumeAvgPeriod);
  const volumeOk = volRatio !== null && volRatio >= cfg.minVolumeRatio;

  // Stop به setup نزدیک متصل است؛ کف قدیمی ۴ ساعته فقط در نبود ناحیه حمایت استفاده می‌شود.
  const supportFloor = support ? levelLower(support) : null;
  const structuralStop = supportFloor !== null && supportFloor < entry
    ? supportFloor
    : structure.lastSwingLow && structure.lastSwingLow < entry
      ? structure.lastSwingLow
      : entry - 2 * atr1h;
  const stop = structuralStop - atr1h * cfg.stopBufferAtr;
  const stopDist = entry - stop;

  // RR خالص پس از برآورد رفت‌وبرگشت کارمزد و لغزش. اولین مانع نیز باید حداقل ۱R فضا بدهد.
  const roundTripCost = entry * 2 * ((cfg.feePct + cfg.slippagePct) / 100);
  const netRisk = stopDist + roundTripCost;
  const rrAt = (price: number) => netRisk > 0 ? (price - entry - roundTripCost) / netRisk : 0;
  const firstResistancePrice = firstResistance ? levelLower(firstResistance) : null;
  const firstResistanceRR = firstResistancePrice !== null ? rrAt(firstResistancePrice) : Infinity;
  const targetLevel = exitLevels.find((level) => rrAt(Math.max(entry, levelLower(level))) >= cfg.minRR) ?? null;
  const measuredMove = structure.lastSwingHigh !== null && structure.lastSwingLow !== null
    ? Math.abs(structure.lastSwingHigh - structure.lastSwingLow)
    : 0;
  // در کشف قیمت که هیچ مقاومت تاریخی بالاتر نیست، دامنه آخرین موج ۴ ساعته هدف ساختاری می‌دهد.
  const projectedTarget = firstResistance === null && measuredMove > 0 ? entry + measuredMove : entry;
  const target = targetLevel ? levelLower(targetLevel) : projectedTarget;
  const rr = rrAt(target);
  const rrOk = firstResistanceRR >= cfg.minFirstResistanceRR && target > entry && rr >= cfg.minRR;

  // ۸) Stop معتبر: فاصله منطقی بر حسب ATR (حیاتی)
  const stopAtrDist = stopDist / atr1h;
  const stopOk = stopDist > 0 && stopAtrDist >= cfg.stopAtrMin && stopAtrDist <= cfg.stopAtrMax;

  const criteria: CriterionResult[] = [
    {
      id: "structure",
      label: "ساختار ۴ ساعته",
      passed: structureOk,
      critical: true,
      detail: structureOk
        ? `روند صعودی با ${structure.lastEvent === "BOS_UP" ? "شکست ساختار (BOS)" : "تغییر جهت (CHoCH)"} تازه`
        : `ساختار نامناسب یا قدیمی (${structure.trend === "down" ? "نزولی" : structure.trend === "up" ? "صعودی بدون شکست تازه" : "خنثی"})`,
    },
    {
      id: "location",
      label: "محل معتبر",
      passed: locationOk,
      critical: true,
      detail: support
        ? locationOk
          ? `نزدیک ناحیه حمایت/Order Block/FVG در ${Math.round(levelUpper(support)).toLocaleString("fa-IR")}`
          : `فاصله تا نزدیک‌ترین سطح ${(distanceToLevel / atr1h).toFixed(1).replace(".", "٫")} برابر ATR — دور است`
        : "سطح حمایتی معتبری یافت نشد",
    },
    {
      id: "pattern",
      label: "الگوی تأیید ورود",
      passed: patternOk,
      critical: false,
      detail: pattern ? `${PATTERN_LABELS[pattern.name]}${patternAge ? ` (${patternAge + 1} کندل اخیر)` : ""}` : `در ${cfg.entryPatternLookback} کندل اخیر الگوی صعودی دیده نشد`,
    },
    {
      id: "momentum15m",
      label: "تریگر شکست ۱۵ دقیقه",
      passed: momentumOk,
      critical: true,
      detail: rsi15 !== null
        ? triggerAge !== null
          ? `شکست سقف سه کندل در ${triggerAge + 1} کندل اخیر؛ RSI: ${Math.round(rsi15).toLocaleString("fa-IR")}`
          : `شکست سقف سه کندل در پنجره ${cfg.entryTriggerLookback} کندلی دیده نشد`
        : "داده کافی برای تریگر و RSI پانزده‌دقیقه نیست",
    },
    {
      id: "rsi",
      label: "RSI(۱۴) یک‌ساعته",
      passed: rsiOk,
      critical: false,
      detail: rsi1h !== null
        ? `RSI: ${Math.round(rsi1h).toLocaleString("fa-IR")} (بازه سالم ${cfg.rsiMin}–${cfg.rsiMax})`
        : "داده کافی نیست",
    },
    {
      id: "volume",
      label: "حجم نسبی",
      passed: volumeOk,
      critical: false,
      detail: volRatio !== null
        ? `حجم کندل سیگنال ${volRatio.toFixed(1).replace(".", "٫")} برابر میانگین ${cfg.volumeAvgPeriod} دوره`
        : "داده حجم کافی نیست",
    },
    {
      id: "riskReward",
      label: `نسبت ریسک/ریوارد ≥ ${cfg.minRR}`,
      passed: rrOk,
      critical: true,
      detail: firstResistance
        ? `فضای مانع اول ${firstResistanceRR.toFixed(2).replace(".", "٫")}R؛ هدف خالص ${rr.toFixed(2).replace(".", "٫")}R در ${Math.round(target).toLocaleString("fa-IR")}`
        : measuredMove > 0
          ? `کشف قیمت؛ هدف دامنه موج ۴ ساعته با RR خالص ${rr.toFixed(2).replace(".", "٫")} در ${Math.round(target).toLocaleString("fa-IR")}`
          : "مقاومت تاریخی یا دامنه موج معتبر برای هدف یافت نشد",
    },
    {
      id: "validStop",
      label: "Stop معتبر",
      passed: stopOk,
      critical: true,
      detail: stopOk
        ? `فاصله Stop ${stopAtrDist.toFixed(1).replace(".", "٫")} برابر ATR — ساختاری و منطقی`
        : stopDist <= 0
          ? "Stop بالای قیمت ورود است — نامعتبر"
          : `فاصله Stop ${stopAtrDist.toFixed(1).replace(".", "٫")} برابر ATR — خارج از بازه ${cfg.stopAtrMin}–${cfg.stopAtrMax}`,
    },
  ];

  const score = criteria.filter((c) => c.passed).length;
  const qualified = qualifiesEntry(criteria, cfg.minConfirmations);

  const grid = buildGrid(candles1h, cfg, atr1h);

  return {
    symbol,
    time,
    side: "buy",
    entry,
    stop,
    target,
    rr,
    score,
    qualified,
    criteria,
    pattern: pattern?.name ?? null,
    atr1h,
    volumeRatio: volRatio ?? 0,
    grid,
  };
}
