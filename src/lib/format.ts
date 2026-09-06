/** ابزارهای قالب‌بندی فارسی: اعداد، قیمت‌ها و تاریخ شمسی */

const faNum = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const faPrice = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const faPct = new Intl.NumberFormat("fa-IR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const faDate = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const faDateTime = new Intl.DateTimeFormat("fa-IR", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const faTime = new Intl.DateTimeFormat("fa-IR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatInt = (n: number): string => faNum.format(Math.round(n));

export function formatPrice(n: number): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return faNum.format(Math.round(n));
  return faPrice.format(n);
}

export function formatPct(n: number, withSign = true): string {
  if (!isFinite(n)) return "—";
  const s = faPct.format(Math.abs(n));
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return withSign ? `${sign}${s}٪` : `${s}٪`;
}

export const formatDate = (ms: number): string => faDate.format(new Date(ms));
export const formatDateTime = (ms: number): string => faDateTime.format(new Date(ms));
export const formatTime = (ms: number): string => faTime.format(new Date(ms));

export function formatToman(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${faPct.format(n / 1_000_000_000)} میلیارد تومان`;
  if (abs >= 1_000_000) return `${faPct.format(n / 1_000_000)} میلیون تومان`;
  return `${faNum.format(n)} تومان`;
}

export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${faNum.format(d)} روز و ${faNum.format(h % 24)} ساعت`;
  }
  if (h > 0) return `${faNum.format(h)} ساعت و ${faNum.format(m)} دقیقه`;
  return `${faNum.format(m)} دقیقه`;
}

/** نام نمایشی نماد نوبیتکس: BTCIRT → بیت‌کوین/تومان */
const COIN_NAMES: Record<string, string> = {
  BTC: "بیت‌کوین",
  ETH: "اتریوم",
  USDT: "تتر",
  TON: "تون‌کوین",
  TRX: "ترون",
  XRP: "ریپل",
  SOL: "سولانا",
  DOGE: "دوج‌کوین",
  LTC: "لایت‌کوین",
  ADA: "کاردانو",
  BNB: "بایننس‌کوین",
  SHIB: "شیبا",
  DOT: "پولکادات",
  LINK: "چین‌لینک",
};

export function symbolLabel(symbol: string): string {
  const base = symbol.replace(/IRT$/, "");
  const name = COIN_NAMES[base];
  return name ? `${name} / تومان` : `${base} / تومان`;
}

export function symbolBase(symbol: string): string {
  return symbol.replace(/IRT$/, "");
}
