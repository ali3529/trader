/**
 * ارسال رویدادهای موتور به سرور برای فوروارد به تلگرام.
 * fire-and-forget: هرگز جریان معامله را متوقف یا کند نمی‌کند.
 */

export interface TelegramSignalData {
  symbol: string;
  score: number;
  qualified: boolean;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  pattern: string | null;
  volumeRatio: number;
  time: number;
  mode: string;
}

export interface TelegramOpenData {
  symbol: string;
  qty: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  score: number;
  mode: string;
  time: number;
}

export interface TelegramCloseData {
  symbol: string;
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  mode: string;
  holdMs: number;
  time: number;
}

export interface TelegramDigestData {
  positions: Array<{
    symbol: string;
    qty: number;
    entry: number;
    price: number;
    pnlPct: number;
    stop: number;
    target: number;
    mode: string;
  }>;
  opportunities: Array<{ symbol: string; score: number; qualified: boolean; price: number }>;
  equity: number;
  riskState: string;
  time: number;
}

export type TelegramNotifyBody =
  | { kind: "signal"; data: TelegramSignalData }
  | { kind: "open"; data: TelegramOpenData }
  | { kind: "close"; data: TelegramCloseData }
  | { kind: "digest"; data: TelegramDigestData };

export function notifyTelegram(body: TelegramNotifyBody): void {
  if (typeof fetch === "undefined") return;
  void fetch("/api/telegram/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}
