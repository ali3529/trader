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

export async function sendTelegram(
  text: string,
  options: { allowWhenDisabled?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadTelegramConfig();
  if (!cfg.enabled && !options.allowWhenDisabled) return { ok: false, error: "تلگرام غیرفعال است" };
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

const LINE = "━━━━━━━━━━━━━━━";

const PATTERN_FA: Record<string, string> = {
  bullish_engulfing: "پوشای صعودی",
  bullish_pinbar: "پین‌بار صعودی",
  hammer: "چکش",
  morning_star: "ستاره صبحگاهی",
  bearish_engulfing: "پوشای نزولی",
  bearish_pinbar: "پین‌بار نزولی",
};

/** BTCIRT / BTCIRR → BTC */
const baseAsset = (symbol: string): string => symbol.replace(/(IRT|IRR|USDT)$/i, "") || symbol;

/** هشتگ قابل جست‌وجو در تلگرام برای هر نماد */
const tag = (symbol: string): string => `#${esc(baseAsset(symbol))}`;

const modeBadge = (mode: string): string => (/^real/i.test(mode) ? "🔴 واقعی" : "🧪 کاغذی");

const signed = (value: number, digits = 2): string =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${faNum(Math.abs(value), digits)}`;

const pctFrom = (from: number, to: number): number => (from > 0 ? ((to - from) / from) * 100 : 0);

/** نوار امتیاز ۸ معیاره: ●●●●●●○○ */
const scoreBar = (score: number, total = 8): string => {
  const filled = Math.max(0, Math.min(total, Math.round(score)));
  return "●".repeat(filled) + "○".repeat(total - filled);
};

/** نوار پیشرفت قیمت بین حد ضرر و هدف: 🛑▱▱▰▱▱▱🎯 */
const progressBar = (stop: number, target: number, price: number, cells = 8): string => {
  if (!(target > stop)) return "";
  const ratio = Math.max(0, Math.min(1, (price - stop) / (target - stop)));
  const at = Math.min(cells - 1, Math.round(ratio * (cells - 1)));
  return `🛑${Array.from({ length: cells }, (_, i) => (i === at ? "◆" : "▱")).join("")}🎯`;
};

const pnlEmoji = (pct: number): string => (pct >= 3 ? "🚀" : pct > 0 ? "🟢" : pct === 0 ? "⚪️" : pct > -2 ? "🟠" : "🔴");

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
  const head = p.qualified
    ? `🟢 <b>سیگنال خرید</b> · ${tag(p.symbol)}`
    : `👀 <b>نزدیک به ورود</b> · ${tag(p.symbol)}`;
  const pattern = p.pattern ? PATTERN_FA[p.pattern] ?? p.pattern : null;
  return [
    head,
    LINE,
    `<b>${esc(baseAsset(p.symbol))}</b> · ${modeBadge(p.mode)}`,
    `امتیاز  <code>${scoreBar(p.score)}</code>  <b>${faNum(p.score)}/۸</b>`,
    pattern ? `🕯 الگو: ${esc(pattern)}` : null,
    "",
    `<blockquote>💰 ورود:  <b>${faPrice(p.entry)}</b>`,
    `🎯 هدف:  ${faPrice(p.target)}  <i>(${signed(pctFrom(p.entry, p.target))}٪)</i>`,
    `🛑 حد ضرر:  ${faPrice(p.stop)}  <i>(${signed(pctFrom(p.entry, p.stop))}٪)</i></blockquote>`,
    `⚖️ R/R <b>${faNum(p.rr, 2)}</b>  ·  📊 حجم <b>${faNum(p.volumeRatio, 1)}×</b>`,
    LINE,
    `🕒 ${faTime(p.time)}`,
  ].filter((line) => line !== null).join("\n");
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
  const notional = p.qty * p.entry;
  const risk = Math.max(0, p.entry - p.stop) * p.qty;
  return [
    `🚀 <b>پوزیشن باز شد</b> · ${tag(p.symbol)}`,
    LINE,
    `<b>${esc(baseAsset(p.symbol))}</b> · ${modeBadge(p.mode)} · امتیاز ${faNum(p.score)}/۸`,
    "",
    `<blockquote>💰 خرید:  <b>${faPrice(p.entry)}</b>`,
    `📦 مقدار:  ${faNum(p.qty, 6)}  <i>(≈ ${faNum(notional)} تومان)</i>`,
    `🎯 هدف:  ${faPrice(p.target)}  <i>(${signed(pctFrom(p.entry, p.target))}٪)</i>`,
    `🛑 حد ضرر:  ${faPrice(p.stop)}  <i>(${signed(pctFrom(p.entry, p.stop))}٪)</i></blockquote>`,
    `⚖️ R/R <b>${faNum(p.rr, 2)}</b>  ·  🔥 ریسک ${faNum(risk)} تومان`,
    LINE,
    `🕒 ${faTime(p.time)}`,
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
  const win = p.pnl > 0;
  const head = win
    ? `✅ <b>بسته شد با سود</b> · ${tag(p.symbol)}`
    : p.pnl === 0
      ? `⚪️ <b>بسته شد سربه‌سر</b> · ${tag(p.symbol)}`
      : `🛑 <b>بسته شد با زیان</b> · ${tag(p.symbol)}`;
  return [
    head,
    LINE,
    `<b>${esc(baseAsset(p.symbol))}</b> · ${modeBadge(p.mode)}`,
    "",
    `${pnlEmoji(p.pnlPct)} <b>${signed(p.pnlPct)}٪</b>  ·  <b>${signed(p.pnl, 0)} تومان</b>`,
    "",
    `<blockquote>📥 ورود:  ${faPrice(p.entry)}`,
    `📤 خروج:  ${faPrice(p.exit)}`,
    `📦 مقدار:  ${faNum(p.qty, 6)}`,
    `🏷 دلیل:  ${esc(p.exitReason)}</blockquote>`,
    `⏱ مدت نگهداری: ${faDuration(p.holdMs)}`,
    LINE,
    `🕒 ${faTime(p.time)}`,
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
  const riskIcon = p.riskState === "عادی" ? "🟢" : p.riskState === "توقف ورود" ? "⛔️" : "🟠";
  const lines: string[] = [
    `📊 <b>گزارش تریدبان</b>`,
    LINE,
    `💼 ارزش حساب: <b>${faNum(p.equity)}</b> تومان`,
    `${riskIcon} وضعیت ریسک: ${esc(p.riskState)}`,
  ];

  lines.push("", `<b>📂 پوزیشن‌های باز (${faNum(p.positions.length)})</b>`);
  if (p.positions.length) {
    for (const pos of p.positions) {
      lines.push(
        `<blockquote>${pnlEmoji(pos.pnlPct)} <b>${esc(baseAsset(pos.symbol))}</b>  <b>${signed(pos.pnlPct)}٪</b>  ${/^real/i.test(pos.mode) ? "🔴" : "🧪"}`,
        `ورود ${faPrice(pos.entry)}  ·  الان ${faPrice(pos.price)}`,
        `${progressBar(pos.stop, pos.target, pos.price)}</blockquote>`,
      );
    }
  } else {
    lines.push("<i>فعلاً پوزیشن بازی نیست.</i>");
  }

  const opps = p.opportunities.slice(0, 5);
  if (opps.length) {
    lines.push("", "<b>🔭 فرصت‌های زیر نظر</b>");
    for (const opp of opps) {
      lines.push(
        `${opp.qualified ? "🟢" : "👀"} <b>${esc(baseAsset(opp.symbol))}</b>  <code>${scoreBar(opp.score)}</code> ${faNum(opp.score)}/۸`,
      );
    }
  }
  lines.push(LINE, `🕒 ${faTime(p.time)}`);
  return lines.join("\n");
}

/** هشدار یکدست برای خطاهای ربات و سفارش‌ها */
export function formatAlert(title: string, body: string): string {
  return [`⚠️ <b>${esc(title)}</b>`, LINE, `<blockquote>${esc(body)}</blockquote>`].join("\n");
}
