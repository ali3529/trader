/** تمام آستانه‌های استراتژی قابل تنظیم هستند — هیچ عددی هاردکد در منطق نیست */

export interface StrategyConfig {
  /** درصد ریسک هر معامله از سرمایه */
  riskPerTradePct: number;
  /** حداقل امتیاز ورود (تعداد تأیید از ۸ معیار) */
  minConfirmations: number;
  /** حداقل نسبت ریسک به ریوارد */
  minRR: number;
  /** RR فعال‌سازی انتقال حد ضرر به نقطه ورود */
  breakEvenRR: number;
  /** RR خروج جزئی (بستن ۵۰٪ پوزیشن) */
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
  /** کارمزد تیکر نوبیتکس */
  feePct: number;
  /** لغزش قیمت شبیه‌سازی‌شده */
  slippagePct: number;
  /** سرمایه اولیه Paper Trading (تومان) */
  paperInitialCapital: number;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  riskPerTradePct: 1,
  minConfirmations: 6,
  minRR: 1.5,
  breakEvenRR: 1.5,
  partialExitRR: 2.5,
  partialExitFraction: 0.5,
  trailingAtrMult: 1.2,
  rsiPeriod: 14,
  atrPeriod: 14,
  volumeAvgPeriod: 10,
  minVolumeRatio: 1,
  rsiMin: 45,
  rsiMax: 70,
  momentumRsiMin: 50,
  momentumRsiMax: 78,
  stopAtrMin: 0.5,
  stopAtrMax: 3,
  maxOpenPositions: 4,
  maxEngagedCapitalPct: 12,
  drawdownHalvePct: 8,
  drawdownStopPct: 12,
  gridLevels: 25,
  gridZones: 5,
  gridMinRangePct: 4,
  gridLookbackDays: 30,
  apiMinIntervalMs: 12_000,
  apiMaxRetries: 3,
  apiRetryDelayMs: 30_000,
  tickIntervalMs: 15 * 60 * 1000,
  levelProximityAtr: 0.6,
  feePct: 0.3,
  slippagePct: 0.05,
  paperInitialCapital: 100_000_000,
};

export const DEFAULT_SYMBOLS = [
  "BTCIRT",
  "ETHIRT",
  "USDTIRT",
  "TONIRT",
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
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<StrategyConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: StrategyConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
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
