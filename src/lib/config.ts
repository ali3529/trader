/** تمام آستانه‌های استراتژی قابل تنظیم هستند — هیچ عددی هاردکد در منطق نیست */

export interface StrategyConfig {
  /** نسخه تنظیمات برای مهاجرت امن مقادیر پیش‌فرض */
  strategyVersion: number;
  /** درصد ریسک هر معامله از سرمایه */
  riskPerTradePct: number;
  /** حداقل امتیاز ورود (تعداد تأیید از ۸ معیار) */
  minConfirmations: number;
  /** حداقل نسبت ریسک به ریوارد */
  minRR: number;
  /** حداقل فضای آزاد تا اولین مقاومت بر حسب R */
  minFirstResistanceRR: number;
  /** تعداد کندل ۱۵ دقیقه برای معتبرماندن تریگر ورود */
  entryTriggerLookback: number;
  /** تعداد کندل یک‌ساعته برای جست‌وجوی الگوی تأیید */
  entryPatternLookback: number;
  /** حداکثر سن رویداد ساختاری ورود بر حسب کندل ۴ ساعته */
  entryStructureBars: number;
  /** RR فعال‌سازی انتقال حد ضرر به نقطه ورود */
  breakEvenRR: number;
  /** RR خروج جزئی */
  partialExitRR: number;
  /** درصد بسته‌شده در خروج جزئی */
  partialExitFraction: number;
  /** ضریب ATR برای فاصله Trailing Stop */
  trailingAtrMult: number;
  /** دوره RSI */
  rsiPeriod: number;
  /** دوره ATR */
  atrPeriod: number;
  /** دوره میانگین حجم */
  volumeAvgPeriod: number;
  /** حداقل نسبت حجم کندل سیگنال به میانگین */
  minVolumeRatio: number;
  /** بازه سالم RSI یک‌ساعته برای ورود (کف) */
  rsiMin: number;
  /** بازه سالم RSI یک‌ساعته برای ورود (سقف) */
  rsiMax: number;
  /** RSI پانزده‌دقیقه برای فیلتر مومنتوم (حداقل) */
  momentumRsiMin: number;
  /** RSI پانزده‌دقیقه بیش‌خرید (وتو) */
  momentumRsiMax: number;
  /** حد ضرر ساختاری: حداقل فاصله بر حسب ATR */
  stopAtrMin: number;
  /** حد ضرر ساختاری: حداکثر فاصله بر حسب ATR */
  stopAtrMax: number;
  /** حداکثر تعداد پوزیشن هم‌زمان */
  maxOpenPositions: number;
  /** حداکثر درصد سرمایه درگیر */
  maxEngagedCapitalPct: number;
  /** حداکثر ریسک باز کل پورتفو به درصد سرمایه */
  maxPortfolioRiskPct: number;
  /** Drawdown برای نصف‌کردن سایز معاملات جدید */
  drawdownHalvePct: number;
  /** Drawdown برای توقف کامل ورودهای جدید */
  drawdownStopPct: number;
  /** تعداد سطوح Grid بین حمایت و مقاومت */
  gridLevels: number;
  /** تعداد ناحیه تقسیم سرمایه از Grid */
  gridZones: number;
  /** حداقل فاصله حمایت/مقاومت (درصد) برای فعال‌بودن Grid */
  gridMinRangePct: number;
  /** پنجره روزهای محاسبه S/R اصلی برای Grid */
  gridLookbackDays: number;
  /** فاصله حداقلی بین درخواست‌های API (میلی‌ثانیه) */
  apiMinIntervalMs: number;
  /** تعداد تلاش مجدد در Rate Limit */
  apiMaxRetries: number;
  /** مکث بین تلاش‌های مجدد (میلی‌ثانیه) */
  apiRetryDelayMs: number;
  /** دوره بررسی بازار (میلی‌ثانیه) — ۱۵ دقیقه */
  tickIntervalMs: number;
  /** تلورانس نزدیکی قیمت به سطح معتبر بر حسب ATR */
  levelProximityAtr: number;
  /** تعداد کندل دو طرف برای تأیید Swing */
  swingLookback: number;
  /** تلورانس خوشه‌بندی سطوح بر حسب ATR */
  levelClusterAtr: number;
  /** حداقل تعداد برخورد برای S/R */
  levelMinTouches: number;
  /** دوره میانگین بدنه برای Order Block */
  orderBlockBodyPeriod: number;
  /** حداقل ضریب بدنه حرکت قوی برای Order Block */
  orderBlockImpulseMult: number;
  /** عمق جست‌وجوی Order Block/FVG بر حسب کندل */
  keyLevelLookbackBars: number;
  /** حداکثر تعداد هر نوع سطح بازگشتی */
  maxKeyLevels: number;
  /** نسبت بدنه میانی FVG به کندل اول */
  fvgImpulseBodyRatio: number;
  /** حاشیه Stop زیر ساختار بر حسب ATR */
  stopBufferAtr: number;
  /** پنجره اعتبار CHoCH نزولی برای خروج */
  exitChochBars: number;
  /** حداقل سهم سایه بلند Pin Bar از کل دامنه */
  pinbarLongWickRatio: number;
  /** حداکثر سهم سایه مخالف Pin Bar */
  pinbarOppositeWickRatio: number;
  /** حداکثر سهم بدنه Pin Bar */
  pinbarMaxBodyRatio: number;
  /** حداقل نسبت بدنه Engulfing به بدنه قبلی */
  engulfingBodyRatio: number;
  /** حداقل نسبت سایه پایین Hammer به بدنه */
  hammerWickBodyRatio: number;
  /** حداکثر سایه مخالف Hammer نسبت به بدنه */
  hammerOppositeWickBodyRatio: number;
  /** پنجره کف محلی Hammer */
  hammerLocalLookback: number;
  /** تلورانس کف Hammer به درصد */
  hammerLowTolerancePct: number;
  /** حداقل نسبت بدنه کندل اول Morning Star */
  morningStarFirstBodyRatio: number;
  /** حداکثر نسبت بدنه میانی Morning Star */
  morningStarMiddleBodyRatio: number;
  /** حداقل بازیابی بدنه در Morning Star */
  morningStarRecoveryRatio: number;
  /** کارمزد تیکر نوبیتکس */
  feePct: number;
  /** لغزش قیمت شبیه‌سازی‌شده */
  slippagePct: number;
  /** سرمایه اولیه Paper Trading (تومان) */
  paperInitialCapital: number;
  /** حداقل ارزش سفارش (تومان) */
  minOrderToman: number;
  /** گیت تصمیم‌گیری AI برای ورود فعال است؟ */
  aiGateEnabled: boolean;
  /** حداقل noul (۰ تا ۱) مورد نیاز برای تأیید ورود توسط AI */
  aiMinDecision: number;
  /** امتیاز ریسک AI (۰ تا ۴) در این حد و بالاتر → ورود مسدود */
  aiMaxRiskScore: number;
  /** ضریب کاهش سایز پوزیشن وقتی AI «کاهش پوزیشن» می‌گوید */
  aiReduceFraction: number;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  strategyVersion: 3,
  riskPerTradePct: 1,
  minConfirmations: 6,
  minRR: 1.4,
  minFirstResistanceRR: 0.8,
  entryTriggerLookback: 4,
  entryPatternLookback: 2,
  entryStructureBars: 12,
  breakEvenRR: 1.5,
  partialExitRR: 1.5,
  partialExitFraction: 0.3,
  trailingAtrMult: 1.5,
  rsiPeriod: 14,
  atrPeriod: 14,
  volumeAvgPeriod: 10,
  minVolumeRatio: 1.1,
  rsiMin: 42,
  rsiMax: 68,
  momentumRsiMin: 48,
  momentumRsiMax: 72,
  stopAtrMin: 0.6,
  stopAtrMax: 3,
  maxOpenPositions: 5,
  maxEngagedCapitalPct: 35,
  maxPortfolioRiskPct: 4,
  drawdownHalvePct: 10,
  drawdownStopPct: 18,
  gridLevels: 25,
  gridZones: 5,
  gridMinRangePct: 4,
  gridLookbackDays: 30,
  apiMinIntervalMs: 12_000,
  apiMaxRetries: 3,
  apiRetryDelayMs: 30_000,
  tickIntervalMs: 15 * 60 * 1000,
  levelProximityAtr: 0.75,
  swingLookback: 2,
  levelClusterAtr: 0.5,
  levelMinTouches: 2,
  orderBlockBodyPeriod: 20,
  orderBlockImpulseMult: 1.5,
  keyLevelLookbackBars: 40,
  maxKeyLevels: 5,
  fvgImpulseBodyRatio: 1,
  stopBufferAtr: 0.3,
  exitChochBars: 4,
  pinbarLongWickRatio: 0.6,
  pinbarOppositeWickRatio: 0.15,
  pinbarMaxBodyRatio: 0.35,
  engulfingBodyRatio: 1,
  hammerWickBodyRatio: 2,
  hammerOppositeWickBodyRatio: 1,
  hammerLocalLookback: 5,
  hammerLowTolerancePct: 0.5,
  morningStarFirstBodyRatio: 0.5,
  morningStarMiddleBodyRatio: 0.4,
  morningStarRecoveryRatio: 0.5,
  feePct: 0.3,
  slippagePct: 0.05,
  paperInitialCapital: 100_000_000,
  minOrderToman: 300_000,
  aiGateEnabled: true,
  aiMinDecision: 0.45,
  aiMaxRiskScore: 4,
  aiReduceFraction: 0.5,
};

export const MAX_WATCH_SYMBOLS = 20;

export const DEFAULT_SYMBOLS = [
  "ZECIRT",
  "ENAIRT",
  "HYPEIRT",
  "TAOIRT",
  "AEROIRT",
  "USELESSIRT",
  "ONDOIRT",
  "SUIIRT",
  "BTCIRT",
  "ETHIRT",
  "USDTIRT",
  "TRXIRT",
  "XRPIRT",
  "SOLIRT",
  "DOGEIRT",
];

const CONFIG_KEY = "tradeban.config.v1";
const SYMBOLS_KEY = "tradeban.symbols.v1";

export function loadConfig(): StrategyConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return normalizeConfig(JSON.parse(raw) as Partial<StrategyConfig>);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: StrategyConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeConfig(cfg)));
}

/** محدودیت‌های ایمنی حتی با دست‌کاری localStorage قابل عبور نیستند. */
export function normalizeConfig(value: Partial<StrategyConfig>): StrategyConfig {
  const isLegacy = (value.strategyVersion ?? 1) < DEFAULT_CONFIG.strategyVersion;
  const merged = { ...DEFAULT_CONFIG, ...value };
  const cfg = isLegacy ? {
    ...merged,
    strategyVersion: DEFAULT_CONFIG.strategyVersion,
    riskPerTradePct: DEFAULT_CONFIG.riskPerTradePct,
    minConfirmations: DEFAULT_CONFIG.minConfirmations,
    minRR: DEFAULT_CONFIG.minRR,
    minFirstResistanceRR: DEFAULT_CONFIG.minFirstResistanceRR,
    entryTriggerLookback: DEFAULT_CONFIG.entryTriggerLookback,
    entryStructureBars: DEFAULT_CONFIG.entryStructureBars,
    stopBufferAtr: DEFAULT_CONFIG.stopBufferAtr,
    maxEngagedCapitalPct: DEFAULT_CONFIG.maxEngagedCapitalPct,
    maxPortfolioRiskPct: DEFAULT_CONFIG.maxPortfolioRiskPct,
    aiMinDecision: DEFAULT_CONFIG.aiMinDecision,
    aiMaxRiskScore: DEFAULT_CONFIG.aiMaxRiskScore,
    partialExitRR: DEFAULT_CONFIG.partialExitRR,
    partialExitFraction: DEFAULT_CONFIG.partialExitFraction,
    trailingAtrMult: DEFAULT_CONFIG.trailingAtrMult,
    minVolumeRatio: DEFAULT_CONFIG.minVolumeRatio,
    rsiMin: DEFAULT_CONFIG.rsiMin,
    rsiMax: DEFAULT_CONFIG.rsiMax,
    momentumRsiMin: DEFAULT_CONFIG.momentumRsiMin,
    momentumRsiMax: DEFAULT_CONFIG.momentumRsiMax,
    stopAtrMin: DEFAULT_CONFIG.stopAtrMin,
    stopAtrMax: DEFAULT_CONFIG.stopAtrMax,
    maxOpenPositions: DEFAULT_CONFIG.maxOpenPositions,
    drawdownHalvePct: DEFAULT_CONFIG.drawdownHalvePct,
    drawdownStopPct: DEFAULT_CONFIG.drawdownStopPct,
    levelProximityAtr: DEFAULT_CONFIG.levelProximityAtr,
  } : merged;
  return {
    ...cfg,
    strategyVersion: DEFAULT_CONFIG.strategyVersion,
    riskPerTradePct: clamp(cfg.riskPerTradePct, 0.01, 3),
    minConfirmations: Math.round(clamp(cfg.minConfirmations, 5, 8)),
    minRR: Math.max(1.2, cfg.minRR),
    minFirstResistanceRR: clamp(cfg.minFirstResistanceRR, 0.5, 3),
    entryTriggerLookback: Math.round(clamp(cfg.entryTriggerLookback, 1, 8)),
    entryPatternLookback: Math.round(clamp(cfg.entryPatternLookback, 1, 5)),
    entryStructureBars: Math.round(clamp(cfg.entryStructureBars, 1, 30)),
    maxOpenPositions: Math.round(clamp(cfg.maxOpenPositions, 1, 8)),
    maxEngagedCapitalPct: clamp(cfg.maxEngagedCapitalPct, 0.1, 60),
    maxPortfolioRiskPct: clamp(cfg.maxPortfolioRiskPct, 0.1, 8),
    partialExitFraction: clamp(cfg.partialExitFraction, 0.01, 0.5),
    gridLevels: Math.round(clamp(cfg.gridLevels, 2, 100)),
    gridZones: Math.round(clamp(cfg.gridZones, 1, 25)),
    apiMinIntervalMs: Math.max(12_000, cfg.apiMinIntervalMs),
    apiMaxRetries: Math.round(clamp(cfg.apiMaxRetries, 0, 3)),
    apiRetryDelayMs: Math.max(30_000, cfg.apiRetryDelayMs),
    tickIntervalMs: Math.max(15 * 60 * 1000, cfg.tickIntervalMs),
    swingLookback: Math.round(clamp(cfg.swingLookback, 1, 10)),
    levelClusterAtr: clamp(cfg.levelClusterAtr, 0.05, 3),
    levelMinTouches: Math.round(clamp(cfg.levelMinTouches, 1, 10)),
    orderBlockBodyPeriod: Math.round(clamp(cfg.orderBlockBodyPeriod, 5, 100)),
    orderBlockImpulseMult: clamp(cfg.orderBlockImpulseMult, 1, 10),
    keyLevelLookbackBars: Math.round(clamp(cfg.keyLevelLookbackBars, 10, 500)),
    maxKeyLevels: Math.round(clamp(cfg.maxKeyLevels, 1, 50)),
    fvgImpulseBodyRatio: clamp(cfg.fvgImpulseBodyRatio, 0.5, 10),
    stopBufferAtr: clamp(cfg.stopBufferAtr, 0, 3),
    exitChochBars: Math.round(clamp(cfg.exitChochBars, 1, 20)),
    pinbarLongWickRatio: clamp(cfg.pinbarLongWickRatio, 0.4, 0.95),
    pinbarOppositeWickRatio: clamp(cfg.pinbarOppositeWickRatio, 0, 0.4),
    pinbarMaxBodyRatio: clamp(cfg.pinbarMaxBodyRatio, 0.05, 0.6),
    engulfingBodyRatio: clamp(cfg.engulfingBodyRatio, 1, 5),
    hammerWickBodyRatio: clamp(cfg.hammerWickBodyRatio, 1, 10),
    hammerOppositeWickBodyRatio: clamp(cfg.hammerOppositeWickBodyRatio, 0, 5),
    hammerLocalLookback: Math.round(clamp(cfg.hammerLocalLookback, 2, 30)),
    hammerLowTolerancePct: clamp(cfg.hammerLowTolerancePct, 0, 5),
    morningStarFirstBodyRatio: clamp(cfg.morningStarFirstBodyRatio, 0.2, 0.9),
    morningStarMiddleBodyRatio: clamp(cfg.morningStarMiddleBodyRatio, 0.05, 0.8),
    morningStarRecoveryRatio: clamp(cfg.morningStarRecoveryRatio, 0.1, 1),
    minOrderToman: Math.max(1, cfg.minOrderToman),
    paperInitialCapital: Math.max(1, cfg.paperInitialCapital),
    aiGateEnabled: Boolean(cfg.aiGateEnabled),
    aiMinDecision: clamp(cfg.aiMinDecision, 0.1, 0.95),
    aiMaxRiskScore: Math.round(clamp(cfg.aiMaxRiskScore, 1, 4)),
    aiReduceFraction: clamp(cfg.aiReduceFraction, 0.1, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function loadSymbols(): string[] {
  try {
    const raw = localStorage.getItem(SYMBOLS_KEY);
    if (!raw) return [...DEFAULT_SYMBOLS];
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.length ? list : [...DEFAULT_SYMBOLS];
  } catch {
    return [...DEFAULT_SYMBOLS];
  }
}

export function saveSymbols(symbols: string[]): void {
  localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols));
}
