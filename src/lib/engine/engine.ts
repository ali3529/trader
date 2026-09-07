import { DEFAULT_CONFIG, loadConfig, loadSymbols, normalizeConfig, saveConfig, saveSymbols } from "../config";
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
import { allLevels, nearestExitLevel } from "../strategy/levels";
import { lastAtr, aggregateCandles } from "../strategy/indicators";
import {
  computeMetrics,
  computePositionSize,
  drawdownPct,
  managePosition,
  riskState,
} from "../risk/risk";
import { configureApi, fetchCandles, getApiLogs, onApiLog } from "./api";
import { NobitexWebSocket } from "./nobitexWebSocket";
import type { NobitexSocketState, RealtimeMarketUpdate } from "./nobitexWebSocket";
import { formatDate } from "../format";

const LEGACY_STORE_KEY = "tradeban.engine.v1";
const PAPER_STORE_KEY = "tradeban.engine.paper.v2";
const REAL_STORE_KEY = "tradeban.engine.real.v2";
const RES: Record<string, string> = { "15m": "900", "1h": "3600", "4h": "14400" };
const RES_MS: Record<string, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };

interface PersistedState {
  cash: number;
  peakEquity: number;
  positions: Position[];
  trades: Trade[];
  equity: EquityPoint[];
  lastSignal1h: Record<string, number>;
  lastProcessed15m: Record<string, number>;
}

interface RealOrderResult {
  orderId: number | null;
  orderStatus: string | null;
  filledQuantity: number;
  averagePrice: number;
  reconciliationRequired: boolean;
}

interface NobitexAccount {
  balances: Record<string, number>;
  totalBalances?: Record<string, number>;
  blockedBalances?: Record<string, number>;
  openOrders: unknown[];
  botOrders?: BotOrderRecord[];
}

interface BotOrderRecord {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  requestedQty: number;
  filledQty: number;
  averagePrice: number;
  status: string;
  reconciliationRequired: boolean;
  createdAt: number;
  positionId: string;
  stop?: number;
  target?: number;
  rr?: number;
  atr?: number;
  signalTime?: number;
  signalScore?: number;
  reason?: string;
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
  account: NobitexAccount | null = null;
  websocket: NobitexSocketState = { status: "idle", privateEnabled: false, lastMessageAt: null, error: null };
  busy = false;
  notice: string | null = null;

  private lastSignal1h: Record<string, number> = {};
  private lastProcessed15m: Record<string, number> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private realtimeNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private accountSyncPromise: Promise<boolean> | null = null;
  private wasPrivateSocketConnected = false;
  private realtimeMarkets: Record<string, RealtimeMarketUpdate> = {};
  private socket: NobitexWebSocket;
  private listeners = new Set<() => void>();

  constructor() {
    this.socket = new NobitexWebSocket({
      onState: (state) => {
        this.websocket = state;
        this.notifyUi();
        const privateConnected = state.status === "connected" && state.privateEnabled;
        if (privateConnected && !this.wasPrivateSocketConnected) {
          void this.syncWithExchange();
        }
        this.wasPrivateSocketConnected = privateConnected;
      },
      onMarket: (update) => this.applyRealtimeMarket(update),
      onPrivateEvent: (kind, data) => this.applyPrivateEvent(kind, data),
    });
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

  private notifyUi(): void {
    this.listeners.forEach((fn) => fn());
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
      lastProcessed15m: this.lastProcessed15m,
    };
    try {
      localStorage.setItem(this.mode === "real" ? REAL_STORE_KEY : PAPER_STORE_KEY, JSON.stringify(state));
    } catch {
      /* حافظه محلی در دسترس نیست */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(PAPER_STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY);
      if (!raw) return;
      this.applyPersisted(JSON.parse(raw) as Partial<PersistedState>);
      this.mode = "paper"; // Real trading must be explicitly re-enabled each session.
    } catch {
      /* حالت اولیه */
    }
  }

  resetPaper(): void {
    if (this.mode === "real") {
      try {
        localStorage.setItem(PAPER_STORE_KEY, JSON.stringify(this.emptyPortfolio(this.cfg.paperInitialCapital)));
      } catch {
        /* حافظه محلی در دسترس نیست */
      }
      this.notice = "حساب Paper بازنشانی شد؛ دفتر واقعی بدون تغییر باقی ماند.";
      this.notifyUi();
      return;
    }
    this.cash = this.cfg.paperInitialCapital;
    this.peakEquity = this.cfg.paperInitialCapital;
    this.positions = [];
    this.trades = [];
    this.equity = [];
    this.lastSignal1h = {};
    this.lastProcessed15m = {};
    this.notify();
  }

  private emptyPortfolio(initialCapital: number): PersistedState {
    return {
      cash: initialCapital,
      peakEquity: initialCapital,
      positions: [],
      trades: [],
      equity: [],
      lastSignal1h: {},
      lastProcessed15m: {},
    };
  }

  private applyPersisted(state: Partial<PersistedState>): void {
    this.cash = Number.isFinite(state.cash) ? Number(state.cash) : this.cfg.paperInitialCapital;
    this.peakEquity = Number.isFinite(state.peakEquity) ? Number(state.peakEquity) : this.cash;
    this.positions = Array.isArray(state.positions) ? state.positions : [];
    this.trades = Array.isArray(state.trades) ? state.trades : [];
    this.equity = Array.isArray(state.equity) ? state.equity : [];
    this.lastSignal1h = state.lastSignal1h ?? {};
    this.lastProcessed15m = state.lastProcessed15m ?? {};
  }

  private loadPortfolio(mode: "paper" | "real"): void {
    const key = mode === "real" ? REAL_STORE_KEY : PAPER_STORE_KEY;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        this.applyPersisted(JSON.parse(raw) as Partial<PersistedState>);
        return;
      }
    } catch {
      /* حالت اولیه امن */
    }
    const initial = mode === "real" ? (this.nobitexEquityToman() ?? 0) : this.cfg.paperInitialCapital;
    this.applyPersisted(this.emptyPortfolio(initial));
  }

  // ---------- پیکربندی ----------

  setConfig(cfg: StrategyConfig): void {
    this.cfg = normalizeConfig(cfg);
    saveConfig(this.cfg);
    configureApi(this.cfg);
    this.notify();
  }

  setSymbols(symbols: string[]): void {
    this.symbols = symbols;
    saveSymbols(symbols);
    this.socket.setSymbols(symbols);
    this.notify();
  }

  async setMode(mode: "paper" | "real"): Promise<void> {
    if (mode === this.mode) return;
    if (mode === "real") {
      const res = await fetch("/api/keys").then((r) => r.json()) as { configured?: boolean; realEnabled?: boolean };
      if (!res.configured || !res.realEnabled) {
        this.notice = "برای معامله واقعی ابتدا کلیدها را در تنظیمات ذخیره و گزینه «معامله واقعی» را با تأیید روشن فعال کنید.";
        this.notify();
        return;
      }
      const synced = await this.syncWithExchange();
      if (!synced) return;
    }
    this.persist();
    this.mode = mode;
    this.loadPortfolio(mode);
    if (mode === "real") {
      this.reconcileRealPositions();
      this.revalueRealCash();
    }
    this.notify();
  }

  /** پس از قطع و وصل اتصال، ابتدا سفارش‌ها و موجودی واقعی صرافی همگام‌سازی می‌شود */
  async syncWithExchange(): Promise<boolean> {
    if (this.accountSyncPromise) return this.accountSyncPromise;
    this.accountSyncPromise = (async () => {
      try {
        const data = await fetch("/api/account", { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }) as NobitexAccount;
        this.account = data;
        if (this.mode === "real") {
          this.reconcileRealPositions();
          this.revalueRealCash();
        }
        this.notice = `همگام‌سازی با نوبیتکس انجام شد — ${Object.keys(data.totalBalances ?? data.balances ?? {}).length} موجودی و ${data.openOrders?.length ?? 0} سفارش باز مشاهده شد.`;
        this.notify();
        return true;
      } catch (err) {
        this.notice = `همگام‌سازی با صرافی ناموفق بود: ${(err as Error).message}`;
        this.mode = "paper";
        this.notify();
        return false;
      }
    })();
    try {
      return await this.accountSyncPromise;
    } finally {
      this.accountSyncPromise = null;
    }
  }

  /** ارزش روز موجودی واقعی نوبیتکس به تومان؛ null یعنی هنوز همگام نشده است. */
  nobitexEquityToman(): number | null {
    if (!this.account) return null;
    const balances = this.account.totalBalances ?? this.account.balances;
    let total = 0;
    for (const [coin, amount] of Object.entries(balances)) {
      if (coin === "RLS" || coin === "IRR") total += amount / 10;
      else if (coin === "IRT") total += amount;
      else {
        const price = this.scans[`${coin}IRT`]?.lastPrice;
        if (price && isFinite(price)) total += amount * price;
      }
    }
    return total;
  }

  /** دفتر واقعی از ارزش صرافی جدا از دفتر Paper نگهداری می‌شود. */
  private revalueRealCash(): void {
    const exchangeEquity = this.nobitexEquityToman();
    if (exchangeEquity === null || !Number.isFinite(exchangeEquity)) return;
    const trackedMarketValue = this.positions.reduce((sum, p) => {
      const price = this.scans[p.symbol]?.lastPrice || p.entry;
      return sum + p.qty * price;
    }, 0);
    // اگر قیمت همه دارایی‌ها هنوز موجود نباشد، مقدار منفی را وارد دفتر نمی‌کنیم.
    if (exchangeEquity >= trackedMarketValue) this.cash = exchangeEquity - trackedMarketValue;
    this.peakEquity = Math.max(this.peakEquity, exchangeEquity);
  }

  /** بازسازی پوزیشن‌های خود ربات از دفتر رمزنگاری‌شده سرور پس از restart/reconnect. */
  private reconcileRealPositions(): void {
    const records = (this.account?.botOrders ?? [])
      .filter((record) => !record.reconciliationRequired && record.filledQty > 0 && record.averagePrice > 0)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!records.length) return;

    const positionIds = new Set(records.map((record) => record.positionId).filter(Boolean));
    const next = this.positions.filter((position) => !positionIds.has(position.id));
    for (const positionId of positionIds) {
      const buys = records.filter((record) => record.positionId === positionId && record.side === "buy");
      if (!buys.length) continue;
      const sells = records.filter((record) => record.positionId === positionId && record.side === "sell");
      const boughtQty = buys.reduce((sum, record) => sum + record.filledQty, 0);
      const soldQty = sells.reduce((sum, record) => sum + record.filledQty, 0);
      let qty = Math.max(0, boughtQty - soldQty);
      const first = buys[0];
      const existing = this.positions.find((position) => position.id === positionId);
      const coin = first.symbol.slice(0, -3);
      const exchangeQty = Number((this.account?.totalBalances ?? this.account?.balances ?? {})[coin]);
      if (Number.isFinite(exchangeQty)) qty = Math.min(qty, Math.max(0, exchangeQty));
      if (qty <= 1e-12) continue;

      const entry = buys.reduce((sum, record) => sum + record.averagePrice * record.filledQty, 0) / boughtQty;
      const initialStop = first.stop && first.stop < entry ? first.stop : entry * 0.98;
      const stop = existing?.stop ?? initialStop;
      const target = existing?.target ?? (first.target && first.target > entry ? first.target : entry + (entry - initialStop) * this.cfg.minRR);
      const legs = sells.map((record) => {
        const fee = record.filledQty * record.averagePrice * (this.cfg.feePct / 100);
        return {
          qty: record.filledQty,
          price: record.averagePrice,
          time: record.createdAt,
          reason: record.reason || "خروج همگام‌شده از نوبیتکس",
          pnl: (record.averagePrice - entry) * record.filledQty - fee,
          fee,
        };
      });
      next.push({
        id: positionId,
        symbol: first.symbol,
        side: "buy",
        qty,
        entry,
        stop,
        initialStop: existing?.initialStop ?? initialStop,
        target,
        rr: existing?.rr ?? first.rr ?? ((target - entry) / Math.max(entry - initialStop, Number.EPSILON)),
        openedAt: existing?.openedAt ?? first.signalTime ?? first.createdAt,
        atr: existing?.atr ?? first.atr ?? Math.max(entry - initialStop, Number.EPSILON),
        trailingActive: existing?.trailingActive ?? false,
        breakEvenDone: existing?.breakEvenDone ?? false,
        partialDone: existing?.partialDone ?? (soldQty > 0),
        notional: qty * entry,
        legs,
        mode: "real",
        signalScore: existing?.signalScore ?? first.signalScore ?? this.cfg.minConfirmations,
      });
    }
    this.positions = next;
  }

  // ---------- زمان‌بندی ----------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.socket.start(this.symbols);
    this.scheduleNext();
    this.timer = setInterval(() => {
      if (this.nextTick && Date.now() >= this.nextTick) void this.tick();
    }, 20_000);
    this.notify();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.socket.stop();
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
            lastPrice: this.realtimeMarkets[symbol]?.price ?? candles1h[candles1h.length - 1].close,
            changePct24h: this.realtimeMarkets[symbol]?.changePct24h ?? changePct24h,
            volume24h: this.realtimeMarkets[symbol]?.volume24h ?? volume24h,
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

  private applyRealtimeMarket(update: RealtimeMarketUpdate): void {
    this.realtimeMarkets[update.symbol] = { ...this.realtimeMarkets[update.symbol], ...update };
    const scan = this.scans[update.symbol];
    if (scan) {
      if (update.price !== undefined && update.price > 0) scan.lastPrice = update.price;
      if (update.changePct24h !== undefined) scan.changePct24h = update.changePct24h;
      if (update.volume24h !== undefined) scan.volume24h = update.volume24h;
      scan.updatedAt = update.receivedAt;
    }
    // Several subscribed channels can publish together; cap React renders.
    if (!this.realtimeNotifyTimer) {
      this.realtimeNotifyTimer = setTimeout(() => {
        this.realtimeNotifyTimer = null;
        this.notifyUi();
      }, 250);
    }
  }

  private applyPrivateEvent(kind: "order" | "trade", data: Record<string, unknown>): void {
    const id = Number(data.orderId ?? data.id);
    if (kind === "order" && this.account) {
      const rest = this.account.openOrders.filter((item) => {
        const value = item as { id?: unknown; orderId?: unknown };
        return Number(value.orderId ?? value.id) !== id;
      });
      const status = String(data.status ?? "").toLowerCase();
      this.account.openOrders = status === "done" || status === "canceled" ? rest : [data, ...rest];
    }
    this.notice = kind === "trade"
      ? `معامله خصوصی نوبیتکس دریافت شد${id ? ` — سفارش ${id}` : ""}.`
      : `وضعیت سفارش نوبیتکس به‌روز شد${id ? ` — ${id}` : ""}.`;
    this.notifyUi();
    if (kind === "trade" && this.mode === "real") void this.syncWithExchange();
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

    const structure4h = analyzeStructure(candles4h, this.cfg.swingLookback);
    const chochDown = hasRecentBearishChoch(structure4h, this.cfg.exitChochBars);

    for (const candle of fresh) {
      const current = this.positions.find((p) => p.id === position.id);
      if (!current) return;
      const atr1h = lastAtr(candles1h, this.cfg.atrPeriod) ?? current.atr;
      const result = managePosition(current, candle, atr1h, this.cfg);

      if (result.stopHit) {
        await this.finalizeClose(current, result.stopHit.price, result.stopHit.reason, candle.time);
        return;
      }
      let nextPosition = result.position;
      if (result.partialClose && result.position) {
        const execution = await this.executePartial(current, result.partialClose.qty, result.partialClose.price, candle.time);
        if (!execution) return;
        const remainingQty = Math.max(0, current.qty - execution.qty);
        nextPosition = {
          ...result.position,
          qty: remainingQty,
          notional: remainingQty * current.entry,
          partialDone: true,
          legs: [
            ...current.legs,
            {
              qty: execution.qty,
              price: execution.price,
              time: candle.time,
              reason: `خروج جزئی در RR=${this.cfg.partialExitRR}`,
              pnl: (execution.price - current.entry) * execution.qty - execution.fee,
              fee: execution.fee,
            },
          ],
        };
      }
      if (nextPosition && result.updated) {
        this.positions = this.positions.map((p) => (p.id === current.id ? nextPosition! : p));
      }
    }

    // خروج با CHoCH نزولی در ۴ ساعته
    const still = this.positions.find((p) => p.id === position.id);
    if (!still) return;
    if (chochDown) {
      const price = candles1h[candles1h.length - 1].close;
      await this.finalizeClose(still, price, "choch_down", Date.now());
      return;
    }

    // خروج با تأیید نزولی روی مقاومت/Order Block/FVG
    const lastPrice = candles1h[candles1h.length - 1].close;
    const atr1h = lastAtr(candles1h, this.cfg.atrPeriod) ?? still.atr;
    const levels = allLevels(candles1h, atr1h, this.cfg);
    const resistance = nearestExitLevel(levels, lastPrice);
    const nearResistance = resistance && Math.abs(resistance.price - lastPrice) <= this.cfg.levelProximityAtr * atr1h;
    const bearish = detectBearishPatterns(candles1h, this.cfg);
    if (nearResistance && bearish.length) {
      const closed = await this.finalizeClose(still, lastPrice, "bearish_confirmation", Date.now());
      if (!closed) return;
      this.notice = `خروج از ${symbol}: ${PATTERN_LABELS[bearish[0].name]} روی مقاومت`;
    }
  }

  private async placeRealOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    price: number;
    stop?: number;
    clientOrderId: string;
    why: string;
    positionId: string;
    target?: number;
    rr?: number;
    atr?: number;
    signalTime?: number;
    signalScore?: number;
  }): Promise<RealOrderResult | null> {
    try {
      const response = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: input.symbol,
          side: input.side,
          type: "market",
          qty: input.qty,
          price: input.price,
          stop: input.stop,
          clientOrderId: input.clientOrderId,
          positionId: input.positionId,
          target: input.target,
          rr: input.rr,
          atr: input.atr,
          signalTime: input.signalTime,
          signalScore: input.signalScore,
          reason: input.why,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.notice = `سفارش واقعی ${input.symbol} (${input.why}) رد شد: ${text.slice(0, 180)}`;
        this.notify();
        return null;
      }
      return await response.json() as RealOrderResult;
    } catch (error) {
      this.notice = `خطای سفارش واقعی ${input.symbol} (${input.why}): ${(error as Error).message}`;
      this.notify();
      return null;
    }
  }

  private async executePartial(p: Position, requestedQty: number, expectedPrice: number, time: number): Promise<{ qty: number; price: number; fee: number } | null> {
    let qty = requestedQty;
    let price = expectedPrice * (1 - this.cfg.slippagePct / 100);
    if (p.mode === "real") {
      const order = await this.placeRealOrder({
        symbol: p.symbol,
        side: "sell",
        qty: requestedQty,
        price: this.scans[p.symbol]?.lastPrice || expectedPrice,
        clientOrderId: this.orderClientId("sell", p.symbol, time),
        why: "خروج جزئی",
        positionId: p.id,
      });
      if (!order || order.reconciliationRequired || order.filledQuantity <= 0 || order.averagePrice <= 0) {
        this.notice = `خروج جزئی ${p.symbol} قطعی نشد؛ دفتر داخلی تغییر نکرد و همگام‌سازی لازم است.`;
        void this.syncWithExchange();
        this.notify();
        return null;
      }
      qty = Math.min(requestedQty, order.filledQuantity);
      price = order.averagePrice;
    }
    const fee = qty * price * (this.cfg.feePct / 100);
    this.cash += qty * price - fee;
    this.markEquity(time);
    return { qty, price, fee };
  }

  private async finalizeClose(p: Position, price: number, reason: Trade["exitReason"], time: number): Promise<boolean> {
    let closedQty = p.qty;
    let fill = price * (1 - this.cfg.slippagePct / 100);
    if (p.mode === "real" && p.qty > 0) {
      const order = await this.placeRealOrder({
        symbol: p.symbol,
        side: "sell",
        qty: p.qty,
        price,
        clientOrderId: this.orderClientId("sell", p.symbol, time),
        why: EXIT_REASON_LABELS[reason],
        positionId: p.id,
      });
      if (!order || order.reconciliationRequired || order.filledQuantity <= 0 || order.averagePrice <= 0) {
        this.notice = `خروج واقعی ${p.symbol} قطعی نشد؛ پوزیشن داخلی باز ماند و همگام‌سازی لازم است.`;
        void this.syncWithExchange();
        this.notify();
        return false;
      }
      closedQty = Math.min(p.qty, order.filledQuantity);
      fill = order.averagePrice;
    }
    const remainingValue = fill * closedQty;
    const fee = remainingValue * (this.cfg.feePct / 100);
    this.cash += remainingValue - fee;

    if (closedQty < p.qty * (1 - 1e-8)) {
      const remainingQty = p.qty - closedQty;
      this.positions = this.positions.map((item) => item.id === p.id ? {
        ...item,
        qty: remainingQty,
        notional: remainingQty * p.entry,
        legs: [...item.legs, {
          qty: closedQty,
          price: fill,
          time,
          reason: `${EXIT_REASON_LABELS[reason]} (اجرای ناقص)`,
          pnl: (fill - p.entry) * closedQty - fee,
          fee,
        }],
      } : item);
      this.notice = `فقط بخشی از خروج ${p.symbol} انجام شد؛ ${remainingQty} واحد هنوز باز است.`;
      this.markEquity(time);
      this.notify();
      return false;
    }

    const partialPnl = p.legs.reduce((a, l) => a + l.pnl, 0);
    const finalPnl = (fill - p.entry) * closedQty - fee;
    const totalQty = p.qty + p.legs.reduce((a, l) => a + l.qty, 0);
    const entryNotional = totalQty * p.entry;
    const entryFee = entryNotional * (this.cfg.feePct / 100);
    const totalPnl = partialPnl + finalPnl - entryFee;
    const exitFees = p.legs.reduce((sum, leg) => sum + (leg.fee ?? 0), 0) + fee;
    const avgExit = totalQty > 0 ? (p.legs.reduce((a, l) => a + l.qty * l.price, 0) + fill * closedQty) / totalQty : fill;
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
      pnlPct: entryNotional > 0 ? (totalPnl / entryNotional) * 100 : 0,
      fees: entryFee + exitFees,
      rrPlanned: p.rr,
      rrActual: riskPerUnit > 0 ? (avgExit - p.entry) / riskPerUnit : 0,
      exitReason: reason,
      entryReason: `سیگنال Price Action با امتیاز ${p.signalScore}/۸`,
      mode: p.mode,
      legs: [...p.legs, { qty: closedQty, price: fill, time, reason: EXIT_REASON_LABELS[reason], pnl: finalPnl, fee }],
      holdMs: Math.max(0, time - p.openedAt),
    };

    this.trades.push(trade);
    this.positions = this.positions.filter((x) => x.id !== p.id);
    this.markEquity(time);
    return true;
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

    let fill = signal.entry * (1 + this.cfg.slippagePct / 100);
    let qty = sizing.qty;

    if (this.mode === "real") {
      const order = await this.placeRealOrder({
        symbol,
        side: "buy",
        qty,
        price: signal.entry,
        stop: signal.stop,
        clientOrderId: this.orderClientId("buy", symbol, signal.time),
        why: "ورود سیگنال Price Action",
        positionId: `${symbol}-${signal.time}`,
        target: signal.target,
        rr: signal.rr,
        atr: signal.atr1h,
        signalTime: signal.time,
        signalScore: signal.score,
      });
      if (!order || order.reconciliationRequired || order.filledQuantity <= 0 || order.averagePrice <= 0) {
        this.notice = `ورود واقعی ${symbol} fill قطعی ندارد؛ پوزیشن داخلی ساخته نشد و همگام‌سازی لازم است.`;
        void this.syncWithExchange();
        this.notify();
        return;
      }
      qty = Math.min(qty, order.filledQuantity);
      fill = order.averagePrice;
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
    void this.finalizeClose(p, price, "manual_close", Date.now());
  }

  async cancelExchangeOrder(id: number): Promise<void> {
    if (this.mode !== "real" || !Number.isInteger(id) || id <= 0) return;
    try {
      const response = await fetch("/api/order", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text.slice(0, 180) || `HTTP ${response.status}`);
      }
      this.notice = `درخواست لغو سفارش ${id.toLocaleString("fa-IR")} تأیید شد.`;
      await this.syncWithExchange();
    } catch (error) {
      this.notice = `لغو سفارش ${id.toLocaleString("fa-IR")} ناموفق بود: ${(error as Error).message}`;
      this.notify();
    }
  }

  private orderClientId(side: "buy" | "sell", symbol: string, time: number): string {
    return `tb-${side}-${symbol}-${Math.floor(time).toString(36)}`.slice(0, 64);
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
    const initialCapital = this.mode === "paper"
      ? this.cfg.paperInitialCapital
      : (this.equity[0]?.equity ?? this.peakEquity ?? eq);
    const metrics = computeMetrics(this.trades, this.equity, initialCapital);
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
      const dailyEquity = this.equity.filter((point) => formatDate(point.time) === date);
      let dailyPeak = dailyEquity[0]?.equity ?? 0;
      let dailyMaxDrawdown = 0;
      for (const point of dailyEquity) {
        dailyPeak = Math.max(dailyPeak, point.equity);
        dailyMaxDrawdown = Math.max(dailyMaxDrawdown, drawdownPct(point.equity, dailyPeak));
      }
      reports.push({
        date,
        trades: list.length,
        wins,
        losses: list.length - wins,
        pnl: list.reduce((a, t) => a + t.pnl, 0),
        winRate: list.length ? (wins / list.length) * 100 : 0,
        maxDrawdownPct: dailyMaxDrawdown,
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
