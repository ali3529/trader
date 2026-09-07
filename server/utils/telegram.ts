import { readState, writeState } from "./stateStore";

/**
 * نوتیفیکیشن تلگرام — تنظیمات در stateStore (رمزنگاری‌شده) با fallback به env.
 * پیام‌ها هم از موتور سمت کلاینت (رویدادها) و بعداً از رانر سمت سرور ارسال می‌شوند.
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  notifySignals: boolean;
  notifyPositions: boolean;
  notifyDigest: boolean;
}

const FILE = "telegram.json";

const DEFAULTS: TelegramConfig = {
  botToken: "",
  chatId: "",
  enabled: false,
  notifySignals: true,
  notifyPositions: true,
  notifyDigest: true,
};

export async function loadTelegramConfig(): Promise<TelegramConfig> {
  const stored = await readState<Partial<TelegramConfig> | null>(FILE, null);
  const cfg: TelegramConfig = { ...DEFAULTS, ...(stored ?? {}) };
  if (!cfg.botToken && process.env.TELEGRAM_BOT_TOKEN) cfg.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!cfg.chatId && process.env.TELEGRAM_CHAT_ID) cfg.chatId = process.env.TELEGRAM_CHAT_ID;
  return cfg;
}

export async function saveTelegramConfig(patch: Partial<TelegramConfig>): Promise<TelegramConfig> {
  const current = await loadTelegramConfig();
  const next: TelegramConfig = {
    ...current,
    ...patch,
    botToken: patch.botToken !== undefined && patch.botToken !== "" ? patch.botToken : current.botToken,
    chatId: patch.chatId !== undefined && patch.chatId !== "" ? patch.chatId : current.chatId,
  };
  await writeState(FILE, next);
  return next;
}

export function maskToken(token: string): string | null {
  if (!token) return null;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

const esc = (value: unknown): string =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const faNum = (value: number, digits = 0): string =>
  value.toLocaleString("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const faPrice = (value: number): string => faNum(value, value < 100 ? 4 : 0);

const faTime = (ms: number): string =>
  new Date(ms).toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

const faDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت و ${faNum(minutes % 60)} دقیقه`;
  return `${faNum(Math.floor(hours / 24))} روز و ${faNum(hours % 24)} ساعت`;
};

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadTelegramConfig();
  if (!cfg.enabled) return { ok: false, error: "تلگرام غیرفعال است" };
  if (!cfg.botToken || !cfg.chatId) return { ok: false, error: "توکن یا chat_id تنظیم نشده است" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || !json?.ok) return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** گفتگوهای اخیر ربات (برای پیدا کردن خودکار chat_id) — کاربر باید اول به ربات پیام داده باشد */
export async function fetchTelegramChatIds(): Promise<Array<{ id: number; title: string }>> {
  const cfg = await loadTelegramConfig();
  if (!cfg.botToken) return [];
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getUpdates`, {
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: Array<{ message?: { chat?: { id?: number; title?: string; first_name?: string; username?: string } } }>;
    } | null;
    if (!json?.ok || !Array.isArray(json.result)) return [];
    const seen = new Map<number, string>();
    for (const update of json.result) {
      const chat = update?.message?.chat;
      if (chat && typeof chat.id === "number") {
        seen.set(chat.id, chat.title ?? chat.first_name ?? chat.username ?? String(chat.id));
      }
    }
    return Array.from(seen, ([id, title]) => ({ id, title }));
  } catch {
    return [];
  }
}

/* --------------------------------- قالب پیام‌ها --------------------------------- */

export interface SignalPayload {
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

export function formatSignal(p: SignalPayload): string {
  return [
    p.qualified ? `🟢 <b>فرصت واجد شرایط — ${esc(p.symbol)}</b>` : `👀 <b>سیگنال تحت نظر — ${esc(p.symbol)}</b>`,
    `امتیاز: <b>${faNum(p.score)} از ۸</b>${p.pattern ? ` | الگو: ${esc(p.pattern)}` : ""}`,
    `ورود: ${faPrice(p.entry)} تومان`,
    `حد ضرر: ${faPrice(p.stop)} | هدف: ${faPrice(p.target)}`,
    `R/R: ${faNum(p.rr, 2)} | حجم نسبی: ${faNum(p.volumeRatio, 1)}×`,
    `کندل سیگنال: ${faTime(p.time)} | حالت: ${esc(p.mode)}`,
  ].join("\n");
}

export interface OpenPayload {
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

export function formatOpen(p: OpenPayload): string {
  return [
    `📈 <b>پوزیشن باز شد — ${esc(p.symbol)}</b> (${esc(p.mode === "real" ? "واقعی" : "کاغذی")})`,
    `خرید ${faNum(p.qty, 6)} واحد @ ${faPrice(p.entry)} تومان`,
    `حد ضرر: ${faPrice(p.stop)} | هدف: ${faPrice(p.target)} | R/R: ${faNum(p.rr, 2)}`,
    `امتیاز سیگنال: ${faNum(p.score)} از ۸ | ${faTime(p.time)}`,
  ].join("\n");
}

export interface ClosePayload {
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

export function formatClose(p: ClosePayload): string {
  const win = p.pnl >= 0;
  return [
    `${win ? "✅" : "🛑"} <b>پوزیشن بسته شد — ${esc(p.symbol)}</b> (${esc(p.mode === "real" ? "واقعی" : "کاغذی")})`,
    `دلیل خروج: ${esc(p.exitReason)}`,
    `سود/زیان: <b>${win ? "+" : ""}${faNum(p.pnl)} تومان</b> (${win ? "+" : ""}${faNum(p.pnlPct, 2)}٪)`,
    `ورود ${faPrice(p.entry)} → خروج ${faPrice(p.exit)} | مقدار ${faNum(p.qty, 6)}`,
    `مدت: ${faDuration(p.holdMs)} | ${faTime(p.time)}`,
  ].join("\n");
}

export interface DigestPosition {
  symbol: string;
  qty: number;
  entry: number;
  price: number;
  pnlPct: number;
  stop: number;
  target: number;
  mode: string;
}

export interface DigestPayload {
  positions: DigestPosition[];
  opportunities: Array<{ symbol: string; score: number; qualified: boolean; price: number }>;
  equity: number;
  riskState: string;
  time: number;
}

export function formatDigest(p: DigestPayload): string {
  const lines = [`📊 <b>گزارش تریدبان</b> — ${faTime(p.time)}`];
  lines.push(`ارزش حساب: ${faNum(p.equity)} تومان | وضعیت ریسک: ${esc(p.riskState)}`);
  if (p.positions.length) {
    lines.push("", "<b>پوزیشن‌های باز:</b>");
    for (const pos of p.positions) {
      lines.push(
        `• ${esc(pos.symbol)} (${esc(pos.mode === "real" ? "واقعی" : "کاغذی")}): ${faNum(pos.qty, 6)} واحد @ ${faPrice(pos.entry)} | فعلی ${faPrice(pos.price)} | <b>${pos.pnlPct >= 0 ? "+" : ""}${faNum(pos.pnlPct, 2)}٪</b> | SL ${faPrice(pos.stop)} / TP ${faPrice(pos.target)}`,
      );
    }
  } else {
    lines.push("", "پوزیشن بازی وجود ندارد.");
  }
  const opps = p.opportunities.slice(0, 5);
  if (opps.length) {
    lines.push("", "<b>فرصت‌های فعال:</b>");
    for (const opp of opps) {
      lines.push(`• ${esc(opp.symbol)}: امتیاز ${faNum(opp.score)} از ۸ ${opp.qualified ? "✅ واجد شرایط" : "👀 تحت نظر"} | قیمت ${faPrice(opp.price)}`);
    }
  }
  return lines.join("\n");
}
