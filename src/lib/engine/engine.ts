import { DEFAULT_CONFIG, loadConfig, loadSymbols, saveConfig, saveSymbols } from "../config";
import type { StrategyConfig } from "../config";
import type {
  ApiLogEntry,
  Candle,
  DailyReport,
  EntrySignal,
  Position,
  SymbolScan,
  Trade,
  EquityPoint,
  BotStats,
} from "../types";
import { evaluateEntry } from "../strategy/scoring";
import { analyzeStructure, hasRecentBearishChoch } from "../strategy/structure";
import { detectBearishPatterns, PATTERN_LABELS } from "../strategy/patterns";
import { allLevels, nearestResistance } from "../strategy/levels";
import { lastAtr, aggregateCandles } from "../strategy/indicators";
import {
  computeMetrics,
  computePositionSize,
  drawdownPct,
  managePosition,
  riskState,
} from "../risk/risk";
import { configureApi, fetchCandles, getApiLogs, onApiLog } from "./api";
import { formatDate } from "../format";

const STORE_KEY = "tradeban.engine.v1";
const RES: Record<string, string> = { "15m": "900", "1h": "3600", "4h": "14400" };
const RES_MS: Record<string, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };

interface PersistedState {
  cash: number;
  peakEquity: number;
  positions: Position[];
  trades: Trade[];
  equity: EquityPoint[];
  lastSignal1h: Record<string, number>;
  mode: "paper" | "real";
}

/** موتور اصلی ربات: اسکن چندنمادی، مدیریت پوزیشن‌ها و Paper/Real Trading */
export class BotEngine {
  cfg: StrategyConfig = loadConfig();
  symbols: string[] = loadSymbols();
  mode: "paper" | "real" = "paper";
  running = false;
  lastTick: number | null = null;
  nextTick: number | null = null;
  scans: Record<string, SymbolScan> = {};
  positions: Position[] = [];
  trades: Trade[] = [];
  equity: EquityPoint[] = [];
  cash: number = this.cfg.paperInitialCapital;
  peakEquity: number = this.cfg.paperInitialCapital;
  apiLogs: ApiLogEntry[] = [];
  account: { balances: Record<string, number>; openOrders: unknown[] } | null = null;
  busy = false;
  notice: string | null = null;

  private lastSignal1h: Record<string, number> = {};
  private lastProcessed15m: Record<string, number> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    configureApi(this.cfg);
    this.restore();
    this.apiLogs = getApiLogs();
    onApiLog((entry) => {
      this.apiLogs = getApiLogs();
      void entry;
      this.notify();
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
    this.persist();
  }

  // ---------- پایداری ----------

  private persist(): void {
    const state: PersistedState = {
      cash: this.cash,
      peakEquity: this.peakEquity,
      positions: this.positions,
      trades: this.trades.slice(-500),
      equity: this.equity.slice(-3000),
      lastSignal1h: this.lastSignal1h,
      mode: this.mode,
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* حافظه محلی در دسترس نیست */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<PersistedState>;
      this.cash = s.cash ?? this.cash;
      this.peakEquity = s.peakEquity ?? this.peakEquity;
      this.positions = s.positions ?? [];
      this.trades = s.trades ?? [];
      this.equity = s.equity ?? [];
      this.lastSignal1h = s.lastSignal1h ?? {};
      this.mode = s.mode === "real" ? "real" : "paper";
    } catch {
      /* حالت اولیه */
    }
  }

  resetPaper(): void {
    this.cash = this.cfg.paperInitialCapital;
    this.peakEquity = this.cfg.paperInitialCapital;
    this.positions = [];
    this.trades = [];
    this.equity = [];
    this.lastSignal1h = {};
    this.lastProcessed15m = {};
    this.notify();
  }

  // ---------- پیکربندی ----------

  setConfig(cfg: StrategyConfig): void {
    this.cfg = cfg;
    saveConfig(cfg);
    configureApi(cfg);
    this.notify();
  }

  setSymbols(symbols: string[]): void {
    this.symbols = symbols;
    saveSymbols(symbols);
    this.notify();
  }

  async setMode(mode: "paper" | "real"): Promise<void> {
    if (mode === "real") {
      const res = await fetch("/api/keys").then((r) => r.json()) as { configured?: boolean; realEnabled?: boolean };
      if (!res.configured || !res.realEnabled) {
        this.notice = "برای معامله واقعی ابتدا کلیدها را در تنظیمات ذخیره و گزینه «معامله واقعی» را با تأیید روشن فعال کنید.";
        this.notify();
        return;
      }
      await this.syncWithExchange();
    }
    this.mode = mode;
    this.notify();
  }

  /** پس از قطع و وصل اتصال، ابتدا سفارش‌ها و موجودی واقعی صرافی همگام‌سازی می‌شود */
  async syncWithExchange(): Promise<void> {
    if (this.mode !== "real") return;
    try {
      const data = await fetch("/api/account").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }) as { balances: Record<string, number>; openOrders: unknown[] };
      this.account = data;
      this.notice = `همگام‌سازی با نوبیتکس انجام شد — ${Object.keys(data.balances ?? {}).length} موجودی و ${data.openOrders?.length ?? 0} سفارش باز مشاهده شد.`;
    } catch (err) {
      this.notice = `همگام‌سازی با صرافی ناموفق بود: ${(err as Error).message}`;
    }
    this.notify();
  }

  // ---------- زمان‌بندی ----------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
    this.timer = setInterval(() => {
      if (this.nextTick && Date.now() >= this.nextTick) void this.tick();
    }, 20_000);
    this.notify();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextTick = null;
    this.notify();
  }

  private scheduleNext(): void {
    const interval = this.cfg.tickIntervalMs;
    // بررسی فقط پس از بسته‌شدن کندل ۱۵ دقیقه + ۶۰ ثانیه حاشیه اطمینان
    const now = Date.now();
    this.nextTick = Math.floor(now / interval) * interval + interval + 60_000;
  }

  // ---------- حلقه اصلی ----------

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const scans: Record<string, SymbolScan> = {};
      let rank = 0;
      const ranked: { symbol: string; volume24h: number }[] = [];

      for (const symbol of this.symbols) {
        try {
          const candles15m = await this.fetchClosed(symbol, "15m", 200);
          const candles1h = await this.fetchClosed(symbol, "1h", 400);
          const candles4h = await this.fetchClosed(symbol, "4h", 300);
          if (!candles15m.length || !candles1h.length || !candles4h.length) {
            scans[symbol] = this.emptyScan(symbol, "داده‌ای از صرافی دریافت نشد");
            continue;
          }

          const last24h = candles1h.slice(-24);
          const volume24h = last24h.reduce((a, c) => a + c.volume * c.close, 0);
          const changePct24h = last24h.length >= 2
            ? ((last24h[last24h.length - 1].close - last24h[0].open) / last24h[0].open) * 100
            : 0;
          ranked.push({ symbol, volume24h });

          // مدیریت پوزیشن باز با کندل‌های ۱۵ دقیقه بسته‌شده از آخرین بررسی
          await this.manageSymbol(symbol, candles15m, candles1h, candles4h);

          // سیگنال جدید فقط روی کندل ۱ ساعته تازه بسته‌شده
          const lastHour = candles1h[candles1h.length - 1].time;
          let signal: EntrySignal | null = null;
          if (this.lastSignal1h[symbol] !== lastHour) {
            signal = evaluateEntry({ symbol, candles4h, candles1h, candles15m, cfg: this.cfg });
            if (signal) this.lastSignal1h[symbol] = lastHour;
            if (signal?.qualified) await this.tryOpen(symbol, signal);
          }

          scans[symbol] = {
            symbol,
            lastPrice: candles1h[candles1h.length - 1].close,
            changePct24h,
            volume24h,
            liquidityRank: 0,
            signal,
            status: signal?.qualified
              ? "qualified"
              : signal
                ? "watching"
                : "watching",
            note: signal ? `امتیاز ${signal.score} از ۸` : "در حال پایش",
            updatedAt: now,
          };
        } catch (err) {
          scans[symbol] = this.emptyScan(symbol, `خطا: ${(err as Error).message}`);
        }
      }

      ranked.sort((a, b) => b.volume24h - a.volume24h);
      ranked.forEach((r, i) => {
        if (scans[r.symbol]) scans[r.symbol].liquidityRank = i + 1;
        rank = i;
      });
      void rank;

      this.scans = scans;
      this.lastTick = Date.now();
      this.scheduleNext();
      this.markEquity();
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  private emptyScan(symbol: string, note: string): SymbolScan {
    return {
      symbol,
      lastPrice: 0,
      changePct24h: 0,
      volume24h: 0,
      liquidityRank: 0,
      signal: null,
      status: "error",
      note,
      updatedAt: Date.now(),
    };
  }

  /** فقط کندل‌های بسته‌شده — کندل در حال تشکیل حذف می‌شود (بدون look-ahead) */
  private async fetchClosed(symbol: string, tf: keyof typeof RES, count: number): Promise<Candle[]> {
    const to = Date.now();
    const from = to - count * RES_MS[tf];
    const candles = await fetchCandles(symbol, RES[tf], from, to);
    const limit = to - RES_MS[tf];
    return candles.filter((c) => c.time <= limit);
  }

  // ---------- مدیریت پوزیشن ----------

  private async manageSymbol(symbol: string, candles15m: Candle[], candles1h: Candle[], candles4h: Candle[]): Promise<void> {
    const position = this.positions.find((p) => p.symbol === symbol);
    if (!position) return;

    const since = this.lastProcessed15m[symbol] ?? candles15m[candles15m.length - 1].time;
    const fresh = candles15m.filter((c) => c.time > since);
    this.lastProcessed15m[symbol] = candles15m[candles15m.length - 1].time;

    const structure4h = analyzeStructure(candles4h);
    const chochDown = hasRecentBearishChoch(structure4h, 4);

    for (const candle of fresh) {
      const current = this.positions.find((p) => p.id === position.id);
      if (!current) return;
      const atr1h = lastAtr(candles1h, this.cfg.atrPeriod) ?? current.atr;
      const result = managePosition(current, candle, atr1h, this.cfg);

      if (result.stopHit) {
        this.finalizeClose(current, result.stopHit.price, result.stopHit.reason, candle.time);
        return;
      }
      if (result.partialClose && result.position) {
        this.applyPartial(current, result.partialClose.qty, result.partialClose.price, candle.time);
      }
      if (result.position && result.updated) {
        this.positions = this.positions.map((p) => (p.id === current.id ? result.position! : p));
      }
    }

    // خروج با CHoCH نزولی در ۴ ساعته
    const still = this.positions.find((p) => p.id === position.id);
    if (!still) return;
    if (chochDown) {
      const price = candles1h[candles1h.length - 1].close;
      this.finalizeClose(still, price, "choch_down", Date.now());
      return;
    }

    // خروج با تأیید نزولی روی مقاومت/Order Block/FVG
    const lastPrice = candles1h[candles1h.length - 1].close;
    const atr1h = lastAtr(candles1h, this.cfg.atrPeriod) ?? still.atr;
    const levels = allLevels(candles1h, atr1h);
    const resistance = nearestResistance(levels, lastPrice * 1.02);
    const nearResistance = resistance && Math.abs(resistance.price - lastPrice) <= this.cfg.levelProximityAtr * atr1h;
    const bearish = detectBearishPatterns(candles1h);
    if (nearResistance && bearish.length) {
      this.finalizeClose(still, lastPrice, "bearish_confirmation", Date.now());
      this.notice = `خروج از ${symbol}: ${PATTERN_LABELS[bearish[0].name]} روی مقاومت`;
    }
  }

  /** ارسال سفارش فروش بازار برای خروج واقعی (طبق مستندات POST /api/orders نوبیتکس) */
  private placeRealSell(symbol: string, qty: number, why: string): void {
    void fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, side: "sell", type: "market", qty }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          this.notice = `سفارش فروش واقعی ${symbol} (${why}) رد شد: ${text.slice(0, 150)}`;
          this.notify();
        }
      })
      .catch((err: unknown) => {
        this.notice = `خطای سفارش فروش واقعی ${symbol} (${why}): ${(err as Error).message}`;
        this.notify();
      });
  }

  private applyPartial(p: Position, qty: number, price: number, time: number): void {
    if (p.mode === "real") this.placeRealSell(p.symbol, qty, "خروج جزئی");
    const fee = qty * price * (this.cfg.feePct / 100);
    this.cash += qty * price - fee;
    const leg = p.legs[p.legs.length - 1];
    if (leg) leg.time = time;
    this.markEquity(time);
  }

  private finalizeClose(p: Position, price: number, reason: Trade["exitReason"], time: number): void {
    if (p.mode === "real" && p.qty > 0) this.placeRealSell(p.symbol, p.qty, EXIT_REASON_LABELS[reason]);
    const fill = price * (1 - this.cfg.slippagePct / 100);
    const remainingValue = fill * p.qty;
    const fee = remainingValue * (this.cfg.feePct / 100);
    this.cash += remainingValue - fee;

    const partialPnl = p.legs.reduce((a, l) => a + l.pnl, 0);
    const finalPnl = (fill - p.entry) * p.qty - fee;
    const totalPnl = partialPnl + finalPnl - p.notional * (this.cfg.feePct / 100);
    const totalQty = p.qty + p.legs.reduce((a, l) => a + l.qty, 0);
    const avgExit = totalQty > 0 ? (p.legs.reduce((a, l) => a + l.qty * l.price, 0) + fill * p.qty) / totalQty : fill;
    const riskPerUnit = p.entry - p.initialStop;

    const trade: Trade = {
      id: p.id,
      symbol: p.symbol,
      openedAt: p.openedAt,
      closedAt: time,
      entry: p.entry,
      exit: avgExit,
      qty: totalQty,
      pnl: totalPnl,
      pnlPct: p.notional > 0 ? (totalPnl / p.notional) * 100 : 0,
      fees: fee + p.notional * (this.cfg.feePct / 100),
      rrPlanned: p.rr,
      rrActual: riskPerUnit > 0 ? (avgExit - p.entry) / riskPerUnit : 0,
      exitReason: reason,
      entryReason: `سیگنال Price Action با امتیاز ${p.signalScore}/۸`,
      mode: p.mode,
      legs: [...p.legs, { qty: p.qty, price: fill, time, reason: EXIT_REASON_LABELS[reason], pnl: finalPnl }],
      holdMs: Math.max(0, time - p.openedAt),
    };

    this.trades.push(trade);
    this.positions = this.positions.filter((x) => x.id !== p.id);
    this.markEquity(time);
  }

  // ---------- ورود ----------

  private async tryOpen(symbol: string, signal: EntrySignal): Promise<void> {
    if (this.positions.some((p) => p.symbol === symbol)) return;

    const equity = this.currentEquity();
    const sizing = computePositionSize({
      equity,
      peakEquity: this.peakEquity,
      entry: signal.entry,
      stop: signal.stop,
      grid: signal.grid,
      openPositions: this.positions,
      cfg: this.cfg,
    });
    if (!sizing.allowed) {
      const scan = this.scans[symbol];
      if (scan) scan.note = sizing.reason;
      return;
    }

    const fill = signal.entry * (1 + this.cfg.slippagePct / 100);
    let qty = sizing.qty;

    if (this.mode === "real") {
      try {
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, side: "buy", type: "market", qty }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          this.notice = `سفارش واقعی ${symbol} رد شد: ${text.slice(0, 150)}`;
          return;
        }
        // پاسخ سرور طبق مستندات نوبیتکس: { orderId, filledQuantity, ... }
        const data = (await res.json()) as { orderId?: number | null; filledQuantity?: number };
        if (data.filledQuantity && data.filledQuantity > 0) qty = data.filledQuantity;
      } catch (err) {
        this.notice = `خطای ارسال سفارش واقعی: ${(err as Error).message}`;
        return;
      }
    }

    const notional = qty * fill;
    const fee = notional * (this.cfg.feePct / 100);
    this.cash -= notional + fee;

    const position: Position = {
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
      mode: this.mode,
      signalScore: signal.score,
    };
    this.positions.push(position);
    this.lastProcessed15m[symbol] = signal.time;
    this.markEquity();
  }

  closePositionManually(id: string): void {
    const p = this.positions.find((x) => x.id === id);
    if (!p) return;
    const scan = this.scans[p.symbol];
    const price = scan?.lastPrice || p.entry;
    this.finalizeClose(p, price, "manual_close", Date.now());
  }

  // ---------- وضعیت ----------

  currentEquity(): number {
    const marketValue = this.positions.reduce((sum, p) => {
      const price = this.scans[p.symbol]?.lastPrice || p.entry;
      return sum + p.qty * price;
    }, 0);
    return this.cash + marketValue;
  }

  private markEquity(time = Date.now()): void {
    const eq = this.currentEquity();
    this.peakEquity = Math.max(this.peakEquity, eq);
    const last = this.equity[this.equity.length - 1];
    if (last && time - last.time < 60_000) last.equity = eq;
    else this.equity.push({ time, equity: eq });
  }

  stats(): BotStats {
    const eq = this.currentEquity();
    const dd = drawdownPct(eq, this.peakEquity);
    const metrics = computeMetrics(this.trades, this.equity, this.cfg.paperInitialCapital);
    const engaged = this.positions.reduce((a, p) => a + p.notional, 0);
    return {
      ...metrics,
      openPositions: this.positions.length,
      engagedCapitalPct: eq > 0 ? (engaged / eq) * 100 : 0,
      drawdownPct: dd,
      riskState: riskState(dd, this.cfg),
      mode: this.mode,
      running: this.running,
      lastTick: this.lastTick,
      nextTick: this.nextTick,
    };
  }

  dailyReports(): DailyReport[] {
    const byDate = new Map<string, Trade[]>();
    for (const t of this.trades) {
      const key = formatDate(t.closedAt);
      const list = byDate.get(key) ?? [];
      list.push(t);
      byDate.set(key, list);
    }
    const reports: DailyReport[] = [];
    for (const [date, list] of byDate) {
      const wins = list.filter((t) => t.pnl > 0).length;
      reports.push({
        date,
        trades: list.length,
        wins,
        losses: list.length - wins,
        pnl: list.reduce((a, t) => a + t.pnl, 0),
        winRate: list.length ? (wins / list.length) * 100 : 0,
        maxDrawdownPct: 0,
      });
    }
    return reports.reverse();
  }
}

export const EXIT_REASON_LABELS: Record<Trade["exitReason"], string> = {
  stop_loss: "حد ضرر اولیه",
  trailing_stop: "تریلینگ استاپ",
  break_even_stop: "استاپ در نقطه ورود",
  partial_take_profit: "سیو سود جزئی",
  choch_down: "CHoCH نزولی در ۴ ساعته",
  bearish_confirmation: "تأیید نزولی روی مقاومت",
  manual_close: "بستن دستی",
  final_close: "بستن نهایی",
};

/** تنها نمونه موتور — در سراسر برنامه مشترک است */
let instance: BotEngine | null = null;
export function getEngine(): BotEngine {
  if (!instance) instance = new BotEngine();
  return instance;
}

export { DEFAULT_CONFIG, aggregateCandles };
