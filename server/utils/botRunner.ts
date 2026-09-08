import { readState, writeState } from "./stateStore";
import { getExchangeProvider } from "./exchangePrefs";
import { publicGet } from "./nobitex";
import { fetchCandles as ramzinexCandles } from "./ramzinex";
import {
  formatClose,
  formatDigest,
  formatOpen,
  formatSignal,
  loadTelegramConfig,
  sendTelegram,
} from "./telegram";
import { DEFAULT_CONFIG, DEFAULT_SYMBOLS, normalizeConfig } from "../../src/lib/config";
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
 * امنیت: رانر سرور فقط کاغذی است. معامله واقعی همچنان از موتور کلاینت و با
 * گیت ENABLE-REAL-TRADING انجام می‌شود. هرگز از داده demo استفاده نمی‌کند —
 * اگر بازار واقعی در دسترس نباشد، نماد با یادداشت رد می‌شود.
 */

const STATE_FILE = "bot-runner.json";
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
      ? stored.symbols.map((s) => String(s).toUpperCase()).slice(0, 12)
      : [...DEFAULT_SYMBOLS];
  return { cfg, symbols };
}

/** ذخیرهٔ پیکربندی/لیست پایش از UI تا رانر ۲۴/۷ با همان تنظیمات کاربر کار کند */
export async function saveRunnerConfig(cfg: StrategyConfig, symbols: string[]): Promise<void> {
  await writeState(CONFIG_FILE, {
    cfg: normalizeConfig(cfg),
    symbols: symbols.map((s) => String(s).toUpperCase()).slice(0, 12),
  } satisfies RunnerConfig);
}

export async function loadRunnerState(): Promise<RunnerState> {
  const { cfg } = await loadRunnerConfig();
  const stored = await readState<Partial<RunnerState> | null>(STATE_FILE, null);
  if (!stored) return freshState(cfg);
  return { ...freshState(cfg), ...stored } as RunnerState;
}

async function saveRunnerState(state: RunnerState): Promise<void> {
  await writeState(STATE_FILE, state);
}

export async function setRunnerRunning(running: boolean): Promise<void> {
  const state = await loadRunnerState();
  state.running = running;
  if (!running) state.tickLockAt = null;
  await saveRunnerState(state);
}

export async function resetRunner(): Promise<void> {
  const { cfg } = await loadRunnerConfig();
  await saveRunnerState(freshState(cfg));
}

/** نوتیفیکیشن با احترام به سوئیچ‌های تلگرام (سیگنال/پوزیشن/گزارش) */
async function notify(kind: "signals" | "positions" | "digest", text: string): Promise<void> {
  const tg = await loadTelegramConfig();
  if (kind === "signals" && !tg.notifySignals) return;
  if (kind === "positions" && !tg.notifyPositions) return;
  if (kind === "digest" && !tg.notifyDigest) return;
  await sendTelegram(text);
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

async function closePosition(
  state: RunnerState,
  p: Position,
  price: number,
  reason: Trade["exitReason"],
  time: number,
  cfg: StrategyConfig,
): Promise<void> {
  const fill = price * (1 - cfg.slippagePct / 100);
  const exitValue = fill * p.qty;
  const exitFee = exitValue * (cfg.feePct / 100);
  state.cash += exitValue - exitFee;

  const partialPnl = p.legs.reduce((a, l) => a + l.pnl, 0);
  const finalPnl = (fill - p.entry) * p.qty - exitFee;
  const totalQty = p.qty + p.legs.reduce((a, l) => a + l.qty, 0);
  const entryNotional = totalQty * p.entry;
  const entryFee = entryNotional * (cfg.feePct / 100);
  const totalPnl = partialPnl + finalPnl;
  const exitValueAll = p.legs.reduce((a, l) => a + l.qty * l.price, 0) + p.qty * fill;
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
    fees: entryFee + exitFee,
    rrPlanned: p.rr,
    rrActual: riskPerUnit > 0 ? (avgExit - p.entry) / riskPerUnit : 0,
    exitReason: reason,
    entryReason: `سیگنال Price Action با امتیاز ${p.signalScore}/۸`,
    mode: "paper",
    legs: [...p.legs, { qty: p.qty, price: fill, time, reason: EXIT_LABEL[reason], pnl: finalPnl, fee: exitFee }],
    holdMs: Math.max(0, time - p.openedAt),
  };
  state.trades.push(trade);
  if (state.trades.length > 500) state.trades = state.trades.slice(-500);
  state.positions = state.positions.filter((x) => x.id !== p.id);
  state.lastPrices[p.symbol] = price;

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
      mode: "paper",
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
        await closePosition(state, current, result.stopHit.price, result.stopHit.reason, candle.time, cfg);
        break;
      }
      if (result.partialClose && result.position) {
        const part = result.partialClose;
        const fee = part.qty * part.price * (cfg.feePct / 100);
        state.cash += part.qty * part.price - fee;
        const legs = result.position.legs.slice();
        const lastIdx = legs.length - 1;
        if (lastIdx >= 0 && legs[lastIdx].time === 0) {
          legs[lastIdx] = { ...legs[lastIdx], time: candle.time, fee, pnl: legs[lastIdx].pnl - fee };
        }
        const updated: Position = { ...result.position, legs };
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
        await closePosition(state, still, lastPrice, "choch_down", Date.now(), cfg);
      } else {
        const atr1h = lastAtr(c1h, cfg.atrPeriod) ?? still.atr;
        const levels = allLevels(c1h, atr1h, cfg);
        const resistance = nearestExitLevel(levels, lastPrice);
        const nearResistance = resistance !== null && Math.abs(resistance.price - lastPrice) <= cfg.levelProximityAtr * atr1h;
        const bearish = detectBearishPatterns(c1h, cfg);
        if (nearResistance && bearish.length) {
          await closePosition(state, still, lastPrice, "bearish_confirmation", Date.now(), cfg);
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
      mode: "paper (سرور ۲۴/۷)",
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

  const fill = signal.entry * (1 + cfg.slippagePct / 100);
  const notional = sizing.qty * fill;
  const fee = notional * (cfg.feePct / 100);
  state.cash -= notional + fee;
  const opened: Position = {
    id: `${symbol}-${signal.time}`,
    symbol,
    side: "buy",
    qty: sizing.qty,
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
    mode: "paper",
    signalScore: signal.score,
  };
  state.positions.push(opened);
  state.lastProcessed15m[symbol] = c15[c15.length - 1].time;

  await notify(
    "positions",
    formatOpen({
      symbol,
      qty: sizing.qty,
      entry: fill,
      stop: signal.stop,
      target: signal.target,
      rr: signal.rr,
      score: signal.score,
      mode: "paper",
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
  const state = await loadRunnerState();
  const { cfg, symbols } = await loadRunnerConfig();
  if (!state.running) return { ok: false, skipped: "stopped" };
  // قفل هم‌پوشانی: اگر tick دیگری در جریان است (cron موازی) رد می‌شویم؛
  // قفل مانده از crash سخت پس از LOCK_MS خودبه‌خود منقضی می‌شود.
  if (state.tickLockAt && started - state.tickLockAt < LOCK_MS) return { ok: false, skipped: "locked" };
  if (state.lastTickAt && started - state.lastTickAt < 60_000) return { ok: false, skipped: "too-soon" };

  const provider = await getExchangeProvider();
  state.tickLockAt = started;
  await saveRunnerState(state);

  const notes: string[] = [];
  try {
    const watch = Array.from(new Set(symbols.map((s) => toProviderSymbol(s, provider))));
    const openSymbols = state.positions.map((p) => p.symbol);
    const pool = watch.filter((s) => !openSymbols.includes(s));
    const slice = pool.slice(state.cursor, state.cursor + BATCH_SIZE);
    state.cursor = pool.length ? (state.cursor + BATCH_SIZE) % pool.length : 0;
    const batch = Array.from(new Set([...openSymbols, ...slice]));

    for (const symbol of batch) {
      try {
        const [c15, c1h, c4h] = await Promise.all([
          closedCandles(symbol, "15m", 120),
          closedCandles(symbol, "1h", 220),
          closedCandles(symbol, "4h", 200),
        ]);
        if (!c15.length || !c1h.length || !c4h.length) {
          notes.push(`${symbol}: کندل زنده‌ای دریافت نشد`);
          continue;
        }
        await manageSymbol(state, symbol, c15, c1h, c4h, cfg);
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
    await saveRunnerState(state).catch(() => undefined);
  }
}

/* ---------------------------------- وضعیت ---------------------------------- */

export async function runnerStatus() {
  const state = await loadRunnerState();
  const equity = currentEquity(state);
  return {
    running: state.running,
    mode: "paper" as const,
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
