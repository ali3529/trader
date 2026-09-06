import type { StrategyConfig } from "../config";
import type { Candle, CriterionResult, EntrySignal } from "../types";
import { lastAtr, lastRsi, volumeRatio } from "./indicators";
import { analyzeStructure, isBullishStructure } from "./structure";
import { detectBullishPatterns, PATTERN_LABELS } from "./patterns";
import {
  allLevels,
  buildGrid,
  nearestResistance,
  nearestSupport,
} from "./levels";

export interface EvaluateInput {
  symbol: string;
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
  cfg: StrategyConfig;
}

/**
 * امتیازدهی ورود با ۸ معیار؛ ورود فقط با عبور از همه شروط حیاتی
 * (ساختار، محل معتبر، تأیید ورود، RR≥1.5، Stop معتبر) و حداقل ۶ تأیید از ۸.
 * Grid هرگز معیار ورود نیست — فقط در سیگنال برای تقسیم سرمایه حمل می‌شود.
 */
export function evaluateEntry({ symbol, candles4h, candles1h, candles15m, cfg }: EvaluateInput): EntrySignal | null {
  if (candles4h.length < 40 || candles1h.length < 60 || candles15m.length < 40) return null;

  const atr1h = lastAtr(candles1h, cfg.atrPeriod);
  if (!atr1h || atr1h <= 0) return null;

  const entry = candles1h[candles1h.length - 1].close;
  const time = candles1h[candles1h.length - 1].time;

  // ۱) ساختار ۴ ساعته (حیاتی)
  const structure = analyzeStructure(candles4h);
  const structureOk = isBullishStructure(structure);

  // سطوح کلیدی یک‌ساعته
  const levels = allLevels(candles1h, atr1h);
  const support = nearestSupport(levels, entry);
  const resistance = nearestResistance(levels, entry);

  // ۲) محل معتبر: نزدیکی قیمت به حمایت/Order Block/FVG (حیاتی)
  const distanceToLevel = support ? entry - support.price : Infinity;
  const locationOk = support !== null && distanceToLevel <= cfg.levelProximityAtr * atr1h;

  // ۳) تأیید ورود: الگوی کندلی روی آخرین کندل بسته‌شده ۱ ساعته (حیاتی)
  const patterns = detectBullishPatterns(candles1h);
  const pattern = patterns[0] ?? null;
  const patternOk = pattern !== null;

  // ۴) فیلتر مومنتوم ۱۵ دقیقه — فقط وتوکننده، نه سیگنال‌دهنده
  const rsi15 = lastRsi(candles15m, cfg.rsiPeriod);
  const momentumOk = rsi15 !== null && rsi15 >= cfg.momentumRsiMin && rsi15 <= cfg.momentumRsiMax;

  // ۵) RSI(14) یک‌ساعته در بازه سالم
  const rsi1h = lastRsi(candles1h, cfg.rsiPeriod);
  const rsiOk = rsi1h !== null && rsi1h >= cfg.rsiMin && rsi1h <= cfg.rsiMax;

  // ۶) حجم کندل سیگنال نسبت به میانگین ۱۰ دوره
  const volRatio = volumeRatio(candles1h, cfg.volumeAvgPeriod);
  const volumeOk = volRatio !== null && volRatio >= cfg.minVolumeRatio;

  // Stop ساختاری: زیر آخرین کف چرخشی یا سطح حمایت، با فاصله ایمنی ATR
  const candidates: number[] = [];
  if (structure.lastSwingLow && structure.lastSwingLow < entry) candidates.push(structure.lastSwingLow);
  if (support && support.price < entry) candidates.push(support.price);
  const structuralStop = candidates.length ? Math.min(...candidates) : entry - 2 * atr1h;
  const stop = structuralStop - atr1h * 0.15;
  const stopDist = entry - stop;

  // ۷) RR حداقل ۱:۱.۵ نسبت به نزدیک‌ترین مقاومت (حیاتی)
  const fallbackTarget = entry + stopDist * (cfg.minRR + 1);
  const target = resistance ? Math.max(resistance.price, entry + stopDist * cfg.minRR) : fallbackTarget;
  const rr = stopDist > 0 ? (target - entry) / stopDist : 0;
  const rrOk = rr >= cfg.minRR;

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
        ? `روند صعودی با رویداد ${structure.lastEvent === "BOS_UP" ? "شکست ساختار (BOS)" : "تغییر جهت (CHoCH)"} صعودی`
        : `ساختار نامناسب (${structure.trend === "down" ? "نزولی" : structure.trend === "up" ? "صعودی بدون شکست تازه" : "خنثی"})`,
    },
    {
      id: "location",
      label: "محل معتبر",
      passed: locationOk,
      critical: true,
      detail: support
        ? locationOk
          ? `نزدیک سطح حمایت/Order Block/FVG در ${Math.round(support.price).toLocaleString("fa-IR")}`
          : `فاصله تا نزدیک‌ترین سطح ${(distanceToLevel / atr1h).toFixed(1).replace(".", "٫")} برابر ATR — دور است`
        : "سطح حمایتی معتبری یافت نشد",
    },
    {
      id: "pattern",
      label: "الگوی تأیید ورود",
      passed: patternOk,
      critical: true,
      detail: pattern ? PATTERN_LABELS[pattern.name] : "الگوی کندلی صعودی روی آخرین کندل بسته‌شده ۱ ساعته دیده نشد",
    },
    {
      id: "momentum15m",
      label: "مومنتوم ۱۵ دقیقه",
      passed: momentumOk,
      critical: false,
      detail: rsi15 !== null
        ? `RSI پانزده‌دقیقه: ${Math.round(rsi15).toLocaleString("fa-IR")} (بازه مجاز ${cfg.momentumRsiMin}–${cfg.momentumRsiMax})`
        : "داده کافی برای RSI پانزده‌دقیقه نیست",
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
      detail: `RR محاسبه‌شده: ${rr.toFixed(2).replace(".", "٫")} تا هدف ${Math.round(target).toLocaleString("fa-IR")}`,
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
  const criticalOk = criteria.every((c) => !c.critical || c.passed);
  const qualified = criticalOk && score >= cfg.minConfirmations;

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
