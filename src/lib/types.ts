/** انواع داده اصلی تریدبان */

export interface Candle {
  /** زمان باز شدن کندل (میلی‌ثانیه UTC) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "15m" | "1h" | "4h";

export type SwingKind = "HH" | "HL" | "LH" | "LL";

export interface SwingPoint {
  index: number;
  price: number;
  time: number;
  kind: SwingKind;
}

export type StructureEvent = "BOS_UP" | "BOS_DOWN" | "CHOCH_UP" | "CHOCH_DOWN";

export interface MarketStructure {
  trend: "up" | "down" | "range";
  swings: SwingPoint[];
  events: { index: number; time: number; type: StructureEvent }[];
  lastEvent: StructureEvent | null;
  lastSwingLow: number | null;
  lastSwingHigh: number | null;
}

export interface Level {
  price: number;
  kind: "support" | "resistance" | "order_block" | "fvg";
  /** جهت ناحیه: demand برای ورود خرید، supply برای مانع/خروج */
  side?: "demand" | "supply";
  strength: number;
  time: number;
}

export interface GridInfo {
  enabled: boolean;
  support: number;
  resistance: number;
  levels: number[];
  /** فاصله حمایت تا مقاومت به درصد */
  rangePct: number;
}

export type PatternName =
  | "bullish_engulfing"
  | "bullish_pinbar"
  | "hammer"
  | "morning_star"
  | "bearish_engulfing"
  | "bearish_pinbar";

export interface PatternHit {
  name: PatternName;
  index: number;
  bullish: boolean;
}

export type CriterionId =
  | "structure"
  | "location"
  | "pattern"
  | "momentum15m"
  | "rsi"
  | "volume"
  | "riskReward"
  | "validStop";

export interface CriterionResult {
  id: CriterionId;
  label: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

export interface EntrySignal {
  symbol: string;
  time: number;
  side: "buy";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  score: number;
  qualified: boolean;
  criteria: CriterionResult[];
  pattern: PatternName | null;
  atr1h: number;
  volumeRatio: number;
  grid: GridInfo | null;
}

export interface PositionLeg {
  qty: number;
  price: number;
  time: number;
  reason: string;
  pnl: number;
  fee?: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: "buy";
  qty: number;
  entry: number;
  stop: number;
  initialStop: number;
  target: number;
  rr: number;
  openedAt: number;
  atr: number;
  trailingActive: boolean;
  breakEvenDone: boolean;
  partialDone: boolean;
  notional: number;
  legs: PositionLeg[];
  mode: "paper" | "real";
  signalScore: number;
}

export type ExitReason =
  | "stop_loss"
  | "trailing_stop"
  | "break_even_stop"
  | "partial_take_profit"
  | "choch_down"
  | "bearish_confirmation"
  | "manual_close"
  | "final_close";

export interface Trade {
  id: string;
  symbol: string;
  openedAt: number;
  closedAt: number;
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  rrPlanned: number;
  rrActual: number;
  exitReason: ExitReason;
  entryReason: string;
  mode: "paper" | "real";
  legs: PositionLeg[];
  holdMs: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface SymbolScan {
  symbol: string;
  lastPrice: number;
  changePct24h: number;
  volume24h: number;
  liquidityRank: number;
  signal: EntrySignal | null;
  status: "qualified" | "watching" | "blocked" | "error";
  note: string;
  updatedAt: number;
}

export interface ApiLogEntry {
  time: number;
  endpoint: string;
  status: "ok" | "retry" | "error";
  attempt: number;
  latencyMs: number;
  detail: string;
}

export interface DailyReport {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  maxDrawdownPct: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  metrics: PerformanceMetrics;
  config: Record<string, number>;
}

export interface PerformanceMetrics {
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  expectancy: number;
  totalPnl: number;
  totalPnlPct: number;
  avgHoldMs: number;
  tradeCount: number;
  avgRR: number;
}

export interface BotStats extends PerformanceMetrics {
  openPositions: number;
  engagedCapitalPct: number;
  drawdownPct: number;
  riskState: "normal" | "halved" | "stopped";
  mode: "paper" | "real";
  running: boolean;
  lastTick: number | null;
  nextTick: number | null;
}
