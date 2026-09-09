import { readState, writeState } from "./stateStore";
import { getExchangeProvider } from "./exchangePrefs";
import { getBotMode, type BotMode } from "./botMode";
import { loadKeys, privateRequest, publicGet } from "./nobitex";
import { fetchAccount as rzFetchAccount, fetchCandles as ramzinexCandles, loadRamzinexKeys } from "./ramzinex";
import { submitRealOrder } from "./orderExecution";
import {
  formatClose,
  formatDigest,
  formatOpen,
  formatSignal,
  loadTelegramConfig,
  sendTelegram,
} from "./telegram";
import { DEFAULT_CONFIG, DEFAULT_SYMBOLS, MAX_WATCH_SYMBOLS, normalizeConfig } from "../../src/lib/config";
import type { StrategyConfig } from "../../src/lib/config";
import type { Candle, EquityPoint, Position, SymbolScan, Trade } from "../../src/lib/types";
import { evaluateEntry } from "../../src/lib/strategy/scoring";
import { analyzeStructure, hasRecentBearishChoch } from "../../src/lib/strategy/structure";
import { detectBearishPatterns } from "../../src/lib/strategy/patterns";
import { allLevels, nearestExitLevel } from "../../src/lib/strategy/levels";
import { lastAtr } from "../../src/lib/strategy/indicators";
import { computePositionSize, drawdownPct, managePosition, positionEquity, riskState } from "../../src/lib/risk/risk";

/**
 * رانر سمت سرور (حالت ۲۴/۷ کاغذی):
 * با Vercel Cron (یا پینگر خارجی) هر ۱۰ دقیقه یک tick اجرا می‌شود؛ فقط کندل‌های
 * بسته خوانده می‌شوند (بدون look-ahead)، پوزیشن‌ها با همان منطق خالص موتور
 * (managePosition + خروج CHoCH/تأیید نزولی) مدیریت می‌شوند و همه‌چیز در
 * stateStore رمزنگاری‌شده باقی می‌ماند تا بین cold startها حفظ شود.
 *
 * امنیت: رانر سرور به‌طور پیش‌فرض کاغذی است. معامله واقعی از سرور فقط وقتی
 * انجام می‌شود که کاربر هر دو گیت را صریحاً روشن کرده باشد: حالت «real»
 * (ذخیره‌شده در سرور از مسیر تأیید ENABLE-REAL-TRADING) + realEnabled کلیدهای
 * صرافی فعال. همان سقف‌های ریسک و تأیید fill سفارش‌ها (orderExecution) اعمال
 * می‌شود و در ابهام، دفتر داخلی هرگز تغییر نمی‌کند. هرگز از داده demo استفاده
 * نمی‌شود — اگر بازار واقعی در دسترس نباشد، نماد با یادداشت رد می‌شود.
 */

const LEGACY_STATE_FILE = "bot-runner.json";
const stateFile = (mode: BotMode): string => `bot-runner-${mode}.json`;
const CONFIG_FILE = "bot-runner-config.json";
const BATCH_SIZE = 2; // نماد جدید در هر tick — سقف زمان تابع serverless
const LOCK_MS = 9 * 60_000; // جلوگیری از tick هم‌پوشان (cron موازی)
const DIGEST_MS = 4 * 3_600_000;
const TICK_INTERVAL_MS = 10 * 60_000;

export interface RunnerState {
  running: boolean;
  cash: number;
  initialCapital: number;
  peakEquity: number;
  positions: Position[];
  trades: Trade[];
  equity: EquityPoint[];
  lastPrices: Record<string, number>;
  lastSignal1h: Record<string, number>;
  lastProcessed15m: Record<string, number>;
  scans: Record<string, SymbolScan>;
  cursor: number;
  lastTickAt: number | null;
  tickLockAt: number | null;
  lastDigestAt: number;
  lastError: string | null;
  lastNotes: string[];
  tickCount: number;
}

export interface RunnerConfig {
  cfg: StrategyConfig;
  symbols: string[];
}

const EXIT_LABEL: Record<Trade["exitReason"], string> = {
  stop_loss: "حد ضرر",
  trailing_stop: "تریلینگ استاپ",
  break_even_stop: "استاپ سربه‌سر",
  partial_take_profit: "سیو سود جزئی",
  choch_down: "CHoCH نزولی",
  bearish_confirmation: "تأیید نزولی",
  manual_close: "بستن دستی",
  final_close: "خروج نهایی",
};

const RISK_FA: Record<string, string> = { normal: "عادی", halved: "نصف‌شده", stopped: "توقف ورود" };

const esc = (value: unknown): string =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function freshState(cfg: StrategyConfig): RunnerState {
  return {
    running: false,
    cash: cfg.paperInitialCapital,
    initialCapital: cfg.paperInitialCapital,
    peakEquity: cfg.paperInitialCapital,
    positions: [],
    trades: [],
    equity: [{ time: Date.now(), equity: cfg.paperInitialCapital }],
    lastPrices: {},
    lastSignal1h: {},
    lastProcessed15m: {},
    scans: {},
    cursor: 0,
    lastTickAt: null,
    tickLockAt: null,
    lastDigestAt: 0,
    lastError: null,
    lastNotes: [],
    tickCount: 0,
  };
}

export async function loadRunnerConfig(): Promise<RunnerConfig> {
  const stored = await readState<Partial<RunnerConfig> | null>(CONFIG_FILE, null);
  const cfg = normalizeConfig({ ...DEFAULT_CONFIG, ...(stored?.cfg ?? {}) } as StrategyConfig);
  const symbols =
    Array.isArray(stored?.symbols) && stored.symbols.length
      ? stored.symbols.map((s) => String(s).toUpperCase()).slice(0, MAX_WATCH_SYMBOLS)
      : [...DEFAULT_SYMBOLS];
  return { cfg, symbols };
}

/** ذخیرهٔ پیکربندی/لیست پایش از UI تا رانر ۲۴/۷ با همان تنظیمات کاربر کار کند */
export async function saveRunnerConfig(cfg: StrategyConfig, symbols: string[]): Promise<void> {
  await writeState(CONFIG_FILE, {
    cfg: normalizeConfig(cfg),
    symbols: symbols.map((s) => String(s).toUpperCase()).slice(0, MAX_WATCH_SYMBOLS),
  } satisfies RunnerConfig);
}

export async function loadRunnerState(mode?: BotMode): Promise<RunnerState> {
  const selectedMode = mode ?? await getBotMode();
  const { cfg } = await loadRunnerConfig();
  let stored = await readState<Partial<RunnerState> | null>(stateFile(selectedMode), null);
  // نسخه‌های قبلی فقط یک دفتر داشتند و آن دفتر همیشه Paper بوده است.
  if (!stored && selectedMode === "paper") {
    stored = await readState<Partial<RunnerState> | null>(LEGACY_STATE_FILE, null);
  }
  if (!stored) return freshState(cfg);
  return { ...freshState(cfg), ...stored } as RunnerState;
}

async function saveRunnerState(state: RunnerState, mode: BotMode): Promise<void> {
  await writeState(stateFile(mode), state);
}

export async function setRunnerRunning(running: boolean, mode?: BotMode): Promise<void> {
  const selectedMode = mode ?? await getBotMode();
  const state = await loadRunnerState(selectedMode);
  state.running = running;
  if (!running) state.tickLockAt = null;
  await saveRunnerState(state, selectedMode);

  // فقط یک دفتر می‌تواند فعال باشد؛ Paper و Real هرگز در یک چرخه مخلوط نمی‌شوند.
  if (running) {
    const otherMode: BotMode = selectedMode === "real" ? "paper" : "real";
    const other = await loadRunnerState(otherMode);
    if (other.running) {
      other.running = false;
      other.tickLockAt = null;
      await saveRunnerState(other, otherMode);
    }
  }
}

export async function resetRunner(mode: BotMode = "paper"): Promise<void> {
  const { cfg } = await loadRunnerConfig();
  await saveRunnerState(freshState(cfg), mode);
}

/** نوتیفیکیشن با احترام به سوئیچ‌های تلگرام (سیگنال/پوزیشن/گزارش) */
async function notify(kind: "signals" | "positions" | "digest", text: string): Promise<void> {
  const tg = await loadTelegramConfig();
  if (kind === "signals" && !tg.notifySignals) return;
  if (kind === "positions" && !tg.notifyPositions) return;
  if (kind === "digest" && !tg.notifyDigest) return;
  await sendTelegram(text);
}

/* ------------------------------ گیت معامله واقعی ------------------------------ */

/**
 * معامله واقعی روی سرور فقط با روشن‌بودن هم‌زمان دو گیت صریح کاربر:
 * ۱) حالت ربات «real» باشد (از مسیر تأیید ENABLE-REAL-TRADING در UI ذخیره شده)
 * ۲) کلیدهای صرافی فعال realEnabled باشند.
 * در صورت بسته‌شدن هر گیت، tick حالت Real به‌صورت fail-closed متوقف می‌شود.
 */
export async function realGateActive(): Promise<boolean> {
  if ((await getBotMode()) !== "real") return false;
  return exchangeRealEnabled();
}

/** وضعیت گیت کلیدهای صرافی فعال، مستقل از انتخاب فعلی mode. */
export async function exchangeRealEnabled(): Promise<boolean> {
  if ((await getExchangeProvider()) === "ramzinex") {
    return (await loadRamzinexKeys())?.realEnabled === true;
  }
  return (await loadKeys())?.realEnabled === true;
}

/** قرارداد دفتر سفارش‌ها و UI نماد IRT است (رمزینکس هم با IRT فراخوانی می‌شود و نگاشت داخلی دارد) */
const toTradeSymbol = (symbol: string): string => symbol.replace(/IRR$/, "IRT");

interface RealOrderInput {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  stop?: number;
  positionId: string;
  target?: number;
  rr?: number;
  atr?: number;
  signalTime?: number;
  signalScore?: number;
  reason: string;
}

/**
 * ثبت سفارش واقعی با همان مسیر امن route (صف سریال + سقف ریسک + تأیید fill).
 * در رد/ابهام: دفتر داخلی تغییر نمی‌کند، یادداشت + هشدار تلگرام و null.
 */
async function placeRealOrder(
  notes: string[],
  input: RealOrderInput,
): Promise<{ qty: number; price: number } | null> {
  const tradeSymbol = toTradeSymbol(input.symbol);
  const clientOrderId = `tb-${input.side}-${tradeSymbol}-${Date.now().toString(36)}`.slice(0, 64);
  try {
    const res = await submitRealOrder({
      symbol: tradeSymbol,
      side: input.side,
      type: "market",
      qty: input.qty,
      price: input.price,
      stop: input.stop,
      clientOrderId,
      positionId: toTradeSymbol(input.positionId),
      target: input.target,
      rr: input.rr,
      atr: input.atr,
      signalTime: input.signalTime,
      signalScore: input.signalScore,
      reason: input.reason,
    });
    if (res.reconciliationRequired || res.filledQuantity <= 0 || res.averagePrice <= 0) {
      notes.push(`${input.symbol}: سفارش واقعی (${input.reason}) قطعی نشد — دفتر تغییر نکرد`);
      await sendTelegram(
        `⚠️ <b>سفارش واقعی ${esc(input.symbol)} مبهم ماند</b>\n${esc(input.reason)} — وضعیت: ${esc(res.orderStatus)}؛ همگام‌سازی دستی لازم است.`,
      ).catch(() => undefined);
      return null;
    }
    return { qty: Math.min(input.qty, res.filledQuantity), price: res.averagePrice };
  } catch (err) {
    const e = err as Error & { statusMessage?: string };
    const message = e.statusMessage ?? e.message;
    notes.push(`${input.symbol}: سفارش واقعی رد شد — ${message}`);
    await sendTelegram(
      `⚠️ <b>رد سفارش واقعی ${esc(input.symbol)}</b>\n${esc(input.reason)}: ${esc(message)}`,
    ).catch(() => undefined);
    return null;
  }
}

/** ارزش‌دهی مجدد نقد از کیف پول صرافی در حالت واقعی: cash = ارزش صرافی − ارزش بازار پوزیشن‌ها */
async function revalueRealCash(state: RunnerState, required = false): Promise<boolean> {
  try {
    const provider = await getExchangeProvider();
    const totals: Record<string, number> = {};
    if (provider === "ramzinex") {
      const acc = await rzFetchAccount();
      Object.assign(totals, acc.totalBalances);
    } else {
      const res = (await privateRequest("GET", "/v2/wallets", { query: { type: "spot" } })) as {
        wallets?: Record<string, { balance?: string | number }>;
      };
      for (const [coin, wallet] of Object.entries(res.wallets ?? {})) {
        totals[coin.toUpperCase()] = Number(wallet?.balance ?? 0);
      }
    }
    let equityToman = 0;
    for (const [coin, amount] of Object.entries(totals)) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (coin === "RLS" || coin === "IRR") equityToman += amount / 10;
      else if (coin === "IRT") equityToman += amount;
      else {
        const price = state.lastPrices[`${coin}IRT`] ?? state.lastPrices[`${coin}IRR`];
        if (price && Number.isFinite(price)) equityToman += amount * price;
      }
    }
    const marketValue = state.positions.reduce(
      (sum, p) => sum + p.qty * (state.lastPrices[p.symbol] ?? p.entry),
      0,
    );
    state.cash = Math.max(0, equityToman - marketValue);
    const initializing = state.tickCount === 0 && state.positions.length === 0 && state.trades.length === 0;
    if (initializing) {
      state.initialCapital = equityToman;
      state.peakEquity = equityToman;
      state.equity = [{ time: Date.now(), equity: equityToman }];
    } else {
      state.peakEquity = Math.max(state.peakEquity, equityToman);
    }
    return true;
  } catch (error) {
    // کیف پول خوانده نشد — دفتر داخلی حفظ می‌شود
    if (required) throw error;
    return false;
  }
}

/* --------------------------------- کندل بسته --------------------------------- */

const TF: Record<"15m" | "1h" | "4h", { minutes: number; ms: number; nobitex: string }> = {
  "15m": { minutes: 15, ms: 900_000, nobitex: "15" },
  "1h": { minutes: 60, ms: 3_600_000, nobitex: "60" },
  "4h": { minutes: 240, ms: 14_400_000, nobitex: "240" },
};

interface RawUdf {
  s?: string;
  errmsg?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

/**
 * فقط کندل‌های بسته‌شده: مرز `to` = لحظهٔ شروع کندل جاری و کندل‌هایی که
 * time + tf <= now ندارند حذف می‌شوند (بدون look-ahead). داده demo هرگز
 * استفاده نمی‌شود — در دسترس‌نبودن بازار، خطا می‌دهد.
 */
async function closedCandles(symbol: string, tf: keyof typeof TF, count: number): Promise<Candle[]> {
  const { minutes, ms, nobitex } = TF[tf];
  const tfSec = ms / 1000;
  const nowMs = Date.now();
  const toSec = Math.floor(nowMs / 1000 / tfSec) * tfSec;
  const fromSec = toSec - count * tfSec;
  let candles: Candle[];
  if ((await getExchangeProvider()) === "ramzinex") {
    const rz = await ramzinexCandles(symbol, minutes, fromSec, toSec);
    candles = rz.t.map((t, i) => ({
      time: t * 1000,
      open: Number(rz.o[i] ?? 0),
      high: Number(rz.h[i] ?? 0),
      low: Number(rz.l[i] ?? 0),
      close: Number(rz.c[i] ?? 0),
      volume: Number(rz.v?.[i] ?? 0),
    }));
  } else {
    const raw = (await publicGet("/market/udf/history", {
      symbol,
      resolution: nobitex,
      from: String(fromSec),
      to: String(toSec),
    })) as RawUdf | RawUdf[];
    const data: RawUdf = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
    if (data.s === "error") throw new Error(data.errmsg ?? "نوبیتکس خطا داد");
    const t = data.t ?? [];
    candles = t.map((time, i) => ({
      time: Number(time) * 1000,
      open: Number(data.o?.[i] ?? 0),
      high: Number(data.h?.[i] ?? 0),
      low: Number(data.l?.[i] ?? 0),
      close: Number(data.c?.[i] ?? 0),
      volume: Number(data.v?.[i] ?? 0),
    }));
  }
  return candles.filter((c) => c.time + ms <= nowMs && c.close > 0);
}

/** نمادهای لیست پایش با قالب نوبیتکس (IRT) ذخیره می‌شوند؛ برای رمزینکس به IRR نگاشت می‌شوند */
function toProviderSymbol(symbol: string, provider: "nobitex" | "ramzinex"): string {
  return provider === "ramzinex" ? symbol.replace(/IRT$/, "IRR") : symbol.replace(/IRR$/, "IRT");
}

/* --------------------------------- مدیریت/خروج --------------------------------- */

function currentEquity(state: RunnerState): number {
  return (
    state.cash +
    state.positions.reduce((sum, p) => sum + positionEquity(p, state.lastPrices[p.symbol] ?? p.entry), 0)
  );
}

/**
 * اجرای خروج: کاغذی با لغزش شبیه‌سازی‌شده؛ واقعی با سفارش sell روی صرافی فعال.
 * در سفارش واقعی ناموفق/مبهم، پوزیشن باز می‌ماند و دفتر تغییر نمی‌کند.
 * fill ناقص → پوزیشن با مقدار باقی‌مانده و leg ثبت‌شده ادامه می‌یابد.
 */
async function executeClose(
  state: RunnerState,
  p: Position,
  price: number,
  reason: Trade["exitReason"],
  time: number,
  cfg: StrategyConfig,
  notes: string[],
): Promise<void> {
  let fill = price * (1 - cfg.slippagePct / 100);
  let closedQty = p.qty;
  if (p.mode === "real") {
    const executed = await placeRealOrder(notes, {
      symbol: p.symbol,
      side: "sell",
      qty: p.qty,
      price,
      positionId: p.id,
      reason: EXIT_LABEL[reason],
    });
    if (!executed) return;
    fill = executed.price;
    closedQty = executed.qty;
  }
  if (closedQty < p.qty * (1 - 1e-8)) {
    const fee = closedQty * fill * (cfg.feePct / 100);
    state.cash += closedQty * fill - fee;
    const remainingQty = p.qty - closedQty;
    state.positions = state.positions.map((item) =>
      item.id === p.id
        ? {
            ...item,
            qty: remainingQty,
            notional: remainingQty * p.entry,
            legs: [
              ...item.legs,
              {
                qty: closedQty,
                price: fill,
                time,
                reason: `${EXIT_LABEL[reason]} (اجرای ناقص)`,
                pnl: (fill - p.entry) * closedQty - fee,
                fee,
              },
            ],
          }
        : item,
    );
    notes.push(`${p.symbol}: فقط بخشی از خروج واقعی انجام شد؛ ${remainingQty} واحد هنوز باز است`);
    return;
  }
  await closePosition(state, p, fill, closedQty, reason, time, cfg);
}

async function closePosition(
  state: RunnerState,
  p: Position,
  fill: number,
  closedQty: number,
  reason: Trade["exitReason"],
  time: number,
  cfg: StrategyConfig,
): Promise<void> {
  const exitValue = fill * closedQty;
  const exitFee = exitValue * (cfg.feePct / 100);
  state.cash += exitValue - exitFee;

  const partialPnl = p.legs.reduce((a, l) => a + l.pnl, 0);
  const partialExitFees = p.legs.reduce((a, l) => a + (l.fee ?? 0), 0);
  const finalPnl = (fill - p.entry) * closedQty - exitFee;
  const totalQty = closedQty + p.legs.reduce((a, l) => a + l.qty, 0);
  const entryNotional = totalQty * p.entry;
  const entryFee = entryNotional * (cfg.feePct / 100);
  // pnl هر leg کارمزد خروج همان leg را دارد؛ کارمزد ورود فقط یک بار اینجا کم می‌شود.
  const totalPnl = partialPnl + finalPnl - entryFee;
  const exitValueAll = p.legs.reduce((a, l) => a + l.qty * l.price, 0) + closedQty * fill;
  const avgExit = totalQty > 0 ? exitValueAll / totalQty : fill;
  const riskPerUnit = p.entry - p.initialStop;

  const trade: Trade = {
    id: `${p.id}-c-${time}`,
    symbol: p.symbol,
    openedAt: p.openedAt,
    closedAt: time,
    entry: p.entry,
    exit: avgExit,
    qty: totalQty,
    pnl: totalPnl,
    pnlPct: entryNotional > 0 ? (totalPnl / entryNotional) * 100 : 0,
    fees: entryFee + partialExitFees + exitFee,
    rrPlanned: p.rr,
    rrActual: riskPerUnit > 0 ? (avgExit - p.entry) / riskPerUnit : 0,
    exitReason: reason,
    entryReason: `سیگنال Price Action با امتیاز ${p.signalScore}/۸`,
    mode: p.mode,
    legs: [...p.legs, { qty: closedQty, price: fill, time, reason: EXIT_LABEL[reason], pnl: finalPnl, fee: exitFee }],
    holdMs: Math.max(0, time - p.openedAt),
  };
  state.trades.push(trade);
  if (state.trades.length > 500) state.trades = state.trades.slice(-500);
  state.positions = state.positions.filter((x) => x.id !== p.id);
  state.lastPrices[p.symbol] = fill;

  await notify(
    "positions",
    formatClose({
      symbol: p.symbol,
      qty: totalQty,
      entry: p.entry,
      exit: avgExit,
      pnl: totalPnl,
      pnlPct: trade.pnlPct,
      exitReason: EXIT_LABEL[reason],
      mode: p.mode,
      holdMs: trade.holdMs,
      time,
    }),
  );
}

async function manageSymbol(
  state: RunnerState,
  symbol: string,
  c15: Candle[],
  c1h: Candle[],
  c4h: Candle[],
  cfg: StrategyConfig,
  real: boolean,
  notes: string[],
): Promise<void> {
  const position = state.positions.find((p) => p.symbol === symbol);
  if (position) {
    const since = state.lastProcessed15m[symbol] ?? c15[c15.length - 1].time;
    const fresh = c15.filter((c) => c.time > since);
    state.lastProcessed15m[symbol] = c15[c15.length - 1].time;

    const structure = analyzeStructure(c4h, cfg.swingLookback);
    const chochDown = hasRecentBearishChoch(structure, cfg.exitChochBars);

    for (const candle of fresh) {
      const current = state.positions.find((p) => p.id === position.id);
      if (!current) break;
      const atr1h = lastAtr(c1h, cfg.atrPeriod) ?? current.atr;
      const result = managePosition(current, candle, atr1h, cfg);
      if (result.stopHit) {
        await executeClose(state, current, result.stopHit.price, result.stopHit.reason, candle.time, cfg, notes);
        break;
      }
      if (result.partialClose && result.position) {
        const part = result.partialClose;
        let qty = part.qty;
        let price = part.price;
        if (current.mode === "real") {
          const executed = await placeRealOrder(notes, {
            symbol: current.symbol,
            side: "sell",
            qty: part.qty,
            price: part.price,
            positionId: current.id,
            reason: "خروج جزئی",
          });
          if (!executed) break; // پوزیشن بدون تغییر می‌ماند؛ کندل بعدی دوباره تلاش می‌کند
          qty = executed.qty;
          price = executed.price;
        }
        const fee = qty * price * (cfg.feePct / 100);
        state.cash += qty * price - fee;
        const legs = result.position.legs.slice();
        const lastIdx = legs.length - 1;
        if (lastIdx >= 0 && legs[lastIdx].time === 0) {
          legs[lastIdx] = {
            qty,
            price,
            time: candle.time,
            reason: legs[lastIdx].reason,
            fee,
            pnl: (price - current.entry) * qty - fee,
          };
        }
        const remainingQty = Math.max(0, current.qty - qty);
        const updated: Position = {
          ...result.position,
          qty: remainingQty,
          notional: remainingQty * current.entry,
          legs,
        };
        state.positions = state.positions.map((p) => (p.id === current.id ? updated : p));
        continue;
      }
      if (result.position && result.updated) {
        const updated = result.position;
        state.positions = state.positions.map((p) => (p.id === current.id ? updated : p));
      }
    }

    const still = state.positions.find((p) => p.id === position.id);
    if (still) {
      const lastPrice = c1h[c1h.length - 1].close;
      if (chochDown) {
        await executeClose(state, still, lastPrice, "choch_down", Date.now(), cfg, notes);
      } else {
        const atr1h = lastAtr(c1h, cfg.atrPeriod) ?? still.atr;
        const levels = allLevels(c1h, atr1h, cfg);
        const resistance = nearestExitLevel(levels, lastPrice);
        const nearResistance = resistance !== null && Math.abs(resistance.price - lastPrice) <= cfg.levelProximityAtr * atr1h;
        const bearish = detectBearishPatterns(c1h, cfg);
        if (nearResistance && bearish.length) {
          await executeClose(state, still, lastPrice, "bearish_confirmation", Date.now(), cfg, notes);
        }
      }
    }
  }

  // نمای بازار در هر تیک تازه می‌شود (قیمت/تغییر ۲۴ ساعته/حجم)
  const lastHour = c1h[c1h.length - 1].time;
  const lastPrice = c1h[c1h.length - 1].close;
  state.lastPrices[symbol] = lastPrice;
  const last24h = c1h.slice(-24);
  const volume24h = last24h.reduce((a, c) => a + c.volume * c.close, 0);
  const firstHour = last24h[0];
  const changePct24h = firstHour ? ((lastPrice - firstHour.open) / firstHour.open) * 100 : 0;
  const prev = state.scans[symbol];
  state.scans[symbol] = {
    symbol,
    lastPrice,
    changePct24h,
    volume24h,
    liquidityRank: 0,
    signal: prev?.signal ?? null,
    status: prev?.status ?? "watching",
    note: prev?.note ?? "در حال پایش",
    updatedAt: Date.now(),
  };

  // سیگنال ورود فقط روی کندل ۱ ساعتهٔ تازه بسته‌شده (یک بار در هر ساعت)
  if (state.lastSignal1h[symbol] === lastHour) return;
  state.lastSignal1h[symbol] = lastHour;

  const signal = evaluateEntry({ symbol, candles4h: c4h, candles1h: c1h, candles15m: c15, cfg });
  if (signal) {
    state.scans[symbol] = {
      ...state.scans[symbol]!,
      signal,
      status: signal.qualified ? "qualified" : "watching",
      note: signal.qualified ? `سیگنال خرید — امتیاز ${signal.score} از ۸` : `امتیاز ${signal.score} از ۸`,
    };
  }
  if (!signal) return;

  await notify(
    "signals",
    formatSignal({
      symbol,
      score: signal.score,
      qualified: signal.qualified,
      entry: signal.entry,
      stop: signal.stop,
      target: signal.target,
      rr: signal.rr,
      pattern: signal.pattern,
      volumeRatio: signal.volumeRatio,
      time: signal.time,
      mode: real ? "real (سرور ۲۴/۷)" : "paper (سرور ۲۴/۷)",
    }),
  );
  if (!signal.qualified) return;
  if (state.positions.some((p) => p.symbol === symbol)) return;

  const equity = currentEquity(state);
  const sizing = computePositionSize({
    equity,
    peakEquity: state.peakEquity,
    entry: signal.entry,
    stop: signal.stop,
    grid: signal.grid,
    openPositions: state.positions,
    cfg,
  });
  if (!sizing.allowed) {
    state.scans[symbol] = { ...state.scans[symbol]!, status: "blocked", note: sizing.reason };
    return;
  }

  let fill = signal.entry * (1 + cfg.slippagePct / 100);
  let qty = sizing.qty;
  let posMode: Position["mode"] = "paper";
  if (real) {
    const executed = await placeRealOrder(notes, {
      symbol,
      side: "buy",
      qty: sizing.qty,
      price: signal.entry,
      stop: signal.stop,
      positionId: `${symbol}-${signal.time}`,
      target: signal.target,
      rr: signal.rr,
      atr: signal.atr1h,
      signalTime: signal.time,
      signalScore: signal.score,
      reason: "ورود سیگنال Price Action (رانر سرور)",
    });
    if (!executed) {
      state.scans[symbol] = { ...state.scans[symbol]!, status: "blocked", note: "سفارش واقعی قطعی نشد — ورود انجام نشد" };
      return;
    }
    fill = executed.price;
    qty = executed.qty;
    posMode = "real";
  }
  const notional = qty * fill;
  const fee = notional * (cfg.feePct / 100);
  state.cash -= notional + fee;
  const opened: Position = {
    id: `${symbol}-${signal.time}`,
    symbol,
    side: "buy",
    qty,
    entry: fill,
    stop: signal.stop,
    initialStop: signal.stop,
    target: signal.target,
    rr: signal.rr,
    openedAt: Date.now(),
    atr: signal.atr1h,
    trailingActive: false,
    breakEvenDone: false,
    partialDone: false,
    notional,
    legs: [],
    mode: posMode,
    signalScore: signal.score,
  };
  state.positions.push(opened);
  state.lastProcessed15m[symbol] = c15[c15.length - 1].time;

  await notify(
    "positions",
    formatOpen({
      symbol,
      qty,
      entry: fill,
      stop: signal.stop,
      target: signal.target,
      rr: signal.rr,
      score: signal.score,
      mode: posMode,
      time: opened.openedAt,
    }),
  );
}

/* ------------------------------------ tick ------------------------------------ */

export interface TickResult {
  ok: boolean;
  skipped?: string;
  batch?: string[];
  notes?: string[];
  positions?: number;
  equity?: number;
  ms?: number;
}

export async function runnerTick(): Promise<TickResult> {
  const started = Date.now();
  const mode = await getBotMode();
  const state = await loadRunnerState(mode);
  const { cfg, symbols } = await loadRunnerConfig();
  if (!state.running) return { ok: false, skipped: "stopped" };
  // قفل هم‌پوشانی: اگر tick دیگری در جریان است (cron موازی) رد می‌شویم؛
  // قفل مانده از crash سخت پس از LOCK_MS خودبه‌خود منقضی می‌شود.
  if (state.tickLockAt && started - state.tickLockAt < LOCK_MS) return { ok: false, skipped: "locked" };
  if (state.lastTickAt && started - state.lastTickAt < 60_000) return { ok: false, skipped: "too-soon" };

  const provider = await getExchangeProvider();
  // Fail closed: اگر کاربر Real را انتخاب کرده ولی گیت کلید بسته شده باشد،
  // رانر به Paper برنمی‌گردد و هیچ معامله‌ای انجام نمی‌دهد.
  const real = mode === "real";
  if (real && !(await exchangeRealEnabled())) {
    state.lastError = "گیت معامله واقعی صرافی فعال بسته است؛ tick بدون معامله متوقف شد";
    state.lastNotes = [state.lastError];
    state.lastTickAt = started;
    await saveRunnerState(state, mode);
    return { ok: false, skipped: "real-gate-closed", notes: state.lastNotes };
  }
  state.tickLockAt = started;
  await saveRunnerState(state, mode);

  const notes: string[] = [];
  try {
    // سایزبندی اولین سفارش واقعی باید بر پایه موجودی صرافی باشد، نه سرمایه Paper.
    if (real) await revalueRealCash(state, true);

    const watch = Array.from(new Set(symbols.map((s) => toProviderSymbol(s, provider))));
    const openSymbols = state.positions.map((p) => p.symbol);
    const activeSymbols = new Set([...watch, ...openSymbols]);
    for (const scannedSymbol of Object.keys(state.scans)) {
      if (!activeSymbols.has(scannedSymbol)) delete state.scans[scannedSymbol];
    }
    const pool = watch.filter((s) => !openSymbols.includes(s));
    const slice = pool.slice(state.cursor, state.cursor + BATCH_SIZE);
    state.cursor = pool.length ? (state.cursor + BATCH_SIZE) % pool.length : 0;
    const batch = Array.from(new Set([...openSymbols, ...slice]));
    // برای Grid سی‌روزه، ۷۲۱ کندل مرزی به‌علاوه حاشیهٔ کندل زنده لازم است.
    const hourlyHistoryCount = Math.max(220, cfg.gridLookbackDays * 24 + 2);

    for (const symbol of batch) {
      try {
        const [c15, c1h, c4h] = await Promise.all([
          closedCandles(symbol, "15m", 120),
          closedCandles(symbol, "1h", hourlyHistoryCount),
          closedCandles(symbol, "4h", 200),
        ]);
        if (!c15.length || !c1h.length || !c4h.length) {
          notes.push(`${symbol}: کندل زنده‌ای دریافت نشد`);
          continue;
        }
        await manageSymbol(state, symbol, c15, c1h, c4h, cfg, real, notes);
      } catch (err) {
        const message = (err as Error).message;
        notes.push(`${symbol}: ${message}`);
        state.scans[symbol] = {
          symbol,
          lastPrice: state.lastPrices[symbol] ?? 0,
          changePct24h: 0,
          volume24h: 0,
          liquidityRank: 0,
          signal: null,
          status: "error",
          note: `خطا: ${message}`,
          updatedAt: Date.now(),
        };
      }
    }

    // رتبه‌بندی مستقل نمادهای اسکن‌شده بر پایه ارزش معاملات ۲۴ ساعته.
    const scans = Object.values(state.scans);
    scans.forEach((scan) => {
      scan.liquidityRank = 0;
    });
    scans
      .filter((scan) => Number.isFinite(scan.volume24h) && scan.volume24h > 0)
      .sort((a, b) => b.volume24h - a.volume24h)
      .forEach((scan, index) => {
        scan.liquidityRank = index + 1;
      });

    // پس از تغییر قیمت‌ها، ارزش حساب واقعی دوباره محاسبه می‌شود.
    if (real) await revalueRealCash(state);

    const equity = currentEquity(state);
    state.peakEquity = Math.max(state.peakEquity, equity);
    state.equity.push({ time: started, equity });
    if (state.equity.length > 3000) state.equity = state.equity.slice(-3000);

    if (started - state.lastDigestAt >= DIGEST_MS) {
      state.lastDigestAt = started;
      await notify(
        "digest",
        formatDigest({
          positions: state.positions.map((p) => {
            const price = state.lastPrices[p.symbol] ?? p.entry;
            return {
              symbol: p.symbol,
              qty: p.qty,
              entry: p.entry,
              price,
              pnlPct: p.entry > 0 ? ((price - p.entry) / p.entry) * 100 : 0,
              stop: p.stop,
              target: p.target,
              mode: p.mode,
            };
          }),
          opportunities: Object.values(state.scans)
            .filter((s) => (s.signal?.score ?? 0) > 0 && started - s.updatedAt < 24 * 3_600_000)
            .sort((a, b) => (b.signal?.score ?? 0) - (a.signal?.score ?? 0))
            .slice(0, 5)
            .map((s) => ({
              symbol: s.symbol,
              score: s.signal?.score ?? 0,
              qualified: s.signal?.qualified ?? false,
              price: s.lastPrice,
            })),
          equity,
          riskState: RISK_FA[riskState(drawdownPct(equity, state.peakEquity), cfg)] ?? "عادی",
          time: started,
        }),
      );
    }

    state.tickCount += 1;
    state.lastTickAt = started;
    state.lastError = null;
    return { ok: true, batch, notes, positions: state.positions.length, equity, ms: Date.now() - started };
  } catch (err) {
    const message = (err as Error).message;
    const isNewError = state.lastError !== message;
    state.lastError = message;
    notes.push(`خطای سراسری: ${message}`);
    if (isNewError) {
      await sendTelegram(`⚠️ <b>خطای ربات سرور تریدبان</b>\n${esc(message)}`).catch(() => undefined);
    }
    return { ok: false, batch: [], notes, ms: Date.now() - started };
  } finally {
    state.tickLockAt = null;
    state.lastNotes = notes.slice(0, 12);
    await saveRunnerState(state, mode).catch(() => undefined);
  }
}

/* ---------------------------------- وضعیت ---------------------------------- */

export async function runnerStatus() {
  const mode = await getBotMode();
  const state = await loadRunnerState(mode);
  const equity = currentEquity(state);
  return {
    running: state.running,
    mode,
    /** در حالت Real اگر این مقدار false شود، tick به‌صورت fail-closed متوقف می‌شود. */
    realReady: mode === "real" ? await exchangeRealEnabled() : false,
    cash: state.cash,
    equity,
    peakEquity: state.peakEquity,
    initialCapital: state.initialCapital,
    positions: state.positions.map((p) => {
      const price = state.lastPrices[p.symbol] ?? p.entry;
      return {
        symbol: p.symbol,
        qty: p.qty,
        entry: p.entry,
        price,
        stop: p.stop,
        target: p.target,
        openedAt: p.openedAt,
        mode: p.mode,
        pnlPct: p.entry > 0 ? ((price - p.entry) / p.entry) * 100 : 0,
      };
    }),
    tradesCount: state.trades.length,
    wins: state.trades.filter((t) => t.pnl > 0).length,
    tickCount: state.tickCount,
    lastTickAt: state.lastTickAt,
    nextTickAt: state.running && state.lastTickAt ? state.lastTickAt + TICK_INTERVAL_MS : null,
    lastError: state.lastError,
    lastNotes: state.lastNotes ?? [],
    scans: Object.values(state.scans)
      .sort((a, b) => (b.signal?.score ?? 0) - (a.signal?.score ?? 0))
      .slice(0, 8)
      .map((s) => ({
        symbol: s.symbol,
        score: s.signal?.score ?? 0,
        qualified: s.signal?.qualified ?? false,
        price: s.lastPrice,
        note: s.note,
        updatedAt: s.updatedAt,
      })),
    /** داده کامل برای آینه‌سازی در UI (داشبورد/پوزیشن‌ها/معاملات/فرصت‌ها) */
    full: {
      positions: state.positions,
      trades: state.trades.slice(-200),
      equityCurve: state.equity.slice(-1500),
      scans: Object.values(state.scans),
      lastPrices: state.lastPrices,
    },
  };
}

export const RUNNER_TICK_INTERVAL_MS = TICK_INTERVAL_MS;
