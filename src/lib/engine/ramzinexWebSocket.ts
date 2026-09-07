import type { NobitexSocketState, RealtimeMarketUpdate } from "./nobitexWebSocket";

/**
 * کلاینت وب‌سوکت رمزینکس — پروتکل بومی Centrifugo طبق docs.ramzinex.ir:
 * - اتصال: wss://websocket.ramzinex.ir/websocket با فرمان {"connect":{"name":"js"},"id":1}
 * - کانال‌های عمومی: orderbook:{pair_id} (اسنپ‌شات کامل buys/sells + lastTradePrice)
 * - Ping/Pong: سرور پیام خالی {} می‌فرستد و کلاینت باید {} برگرداند (مهلت ۲۵ ثانیه)
 * - از delta:'fossil' استفاده نمی‌کنیم؛ اسنپ‌شات کامل کافی و ساده‌تر است.
 * کانال‌های خصوصی رمزینکس پیاده‌سازی نشده‌اند — همگام‌سازی حساب از REST انجام می‌شود.
 */

export interface MarketSocketCallbacks {
  onState: (state: NobitexSocketState) => void;
  onMarket: (update: RealtimeMarketUpdate) => void;
  onPrivateEvent: (kind: "order" | "trade", data: Record<string, unknown>) => void;
}

/** رابط مشترک سوکت بازار تا موتور بتواند نوبیتکس/رمزینکس را جابه‌جا کند */
export interface MarketSocket {
  start(symbols: string[]): void;
  setSymbols(symbols: string[]): void;
  stop(): void;
}

const WS_URL = "wss://websocket.ramzinex.ir/websocket";

export class RamzinexWebSocket implements MarketSocket {
  private socket: WebSocket | null = null;
  private symbols: string[] = [];
  private callbacks: MarketSocketCallbacks;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 2;
  private pendingSubs = new Map<number, string>();
  private channelSymbols = new Map<string, string>();
  private state: NobitexSocketState = {
    status: "idle",
    privateEnabled: false,
    lastMessageAt: null,
    error: null,
  };

  constructor(callbacks: MarketSocketCallbacks) {
    this.callbacks = callbacks;
  }

  start(symbols: string[]): void {
    this.symbols = normalizeSymbols(symbols);
    if (typeof WebSocket === "undefined") return;
    this.stopped = false;
    this.clearTimers();
    this.socket?.close(1000, "restart");
    this.socket = null;
    void this.open(false);
  }

  setSymbols(symbols: string[]): void {
    const next = normalizeSymbols(symbols);
    if (next.join(",") === this.symbols.join(",")) return;
    this.symbols = next;
    if (!this.stopped) this.restart();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "stopped");
    this.setState({ status: "idle", privateEnabled: false, error: null });
  }

  private restart(): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(4000, "restart");
    void this.open(false);
  }

  /** نگاشت نماد→شناسه بازار از سرور؛ اگر صرافی فعال رمزینکس نباشد سوکت خاموش می‌ماند */
  private async loadMarkets(): Promise<Map<string, number> | null> {
    try {
      const exchangeResponse = await fetch("/api/exchange", { cache: "no-store" });
      if (exchangeResponse.ok) {
        const data = (await exchangeResponse.json()) as { provider?: string };
        if (data.provider !== "ramzinex") return null;
      }
      const marketsResponse = await fetch("/api/ramzinex/markets", { cache: "no-store" });
      if (!marketsResponse.ok) return new Map();
      const body = (await marketsResponse.json()) as { markets?: Record<string, number> };
      const map = new Map<string, number>();
      for (const [symbol, id] of Object.entries(body.markets ?? {})) {
        if (Number.isInteger(id) && id > 0) map.set(symbol, id);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private async open(reconnecting: boolean): Promise<void> {
    if (this.stopped) return;
    this.setState({ status: reconnecting ? "reconnecting" : "connecting", error: null });

    const markets = await this.loadMarkets();
    if (this.stopped) return;
    if (markets === null) {
      console.info("[ramzinex-ws] disabled — صرافی فعال رمزینکس نیست");
      this.setState({ status: "idle", privateEnabled: false, error: null });
      return;
    }

    console.info(`[ramzinex-ws] opening ${WS_URL}`);
    const socket = new WebSocket(WS_URL);
    this.socket = socket;
    this.channelSymbols.clear();
    for (const symbol of this.symbols) {
      const pairId = markets.get(symbol) ?? markets.get(symbol.replace(/IRT$/, "IRR")) ?? markets.get(symbol.replace(/IRR$/, "IRT"));
      if (pairId === undefined) {
        console.info(`[ramzinex-ws] no pair id for ${symbol} — skipping stream`);
        continue;
      }
      this.channelSymbols.set(`orderbook:${pairId}`, symbol);
    }

    socket.onopen = () => {
      if (this.socket !== socket) return;
      console.info("[ramzinex-ws] tcp/tls open — sending connect command");
      socket.send(JSON.stringify({ id: 1, connect: { name: "js" } }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      for (const line of event.data.split("\n").filter(Boolean)) this.handleMessage(socket, line);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      console.info("[ramzinex-ws] socket error event (network/DNS/origin block?)");
      this.setState({ status: "error", error: "خطای اتصال WebSocket رمزینکس" });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      console.info(`[ramzinex-ws] closed code=${event.code} reason=${event.reason || "—"}`);
      this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private handleMessage(socket: WebSocket, line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    // مکانیزم Ping/Pong رمزینکس: پیام خالی {} ↔ پاسخ {}
    if (Object.keys(message).length === 0) {
      socket.send("{}");
      return;
    }

    if (message.id === 1 && message.connect) {
      this.reconnectAttempt = 0;
      this.setState({ status: "connected", privateEnabled: false, error: this.state.error });
      this.subscribe(socket);
      return;
    }

    const push = asRecord(message.push);
    const publication = asRecord(push?.pub);
    if (push?.channel && publication?.data !== undefined) {
      const data = asRecord(publication.data);
      if (!data) return;
      const now = Date.now();
      this.setState({ lastMessageAt: now });
      this.routePublication(String(push.channel), data, now);
      return;
    }

    const disconnect = asRecord(message.disconnect);
    if (disconnect) {
      console.info(`[ramzinex-ws] server disconnect code=${String(disconnect.code)} reason=${String(disconnect.reason ?? "")}`);
      return;
    }

    const error = asRecord(message.error);
    if (error) {
      const commandId = typeof message.id === "number" ? message.id : null;
      const channel = commandId !== null ? this.pendingSubs.get(commandId) : undefined;
      if (channel) {
        this.pendingSubs.delete(commandId as number);
        console.info(`[ramzinex-ws] subscribe failed: ${channel} | ${String(error.message ?? error.code ?? "")}`);
        return;
      }
      this.setState({ status: "error", error: String(error.message ?? error.code ?? "WebSocket protocol error") });
    }
  }

  private subscribe(socket: WebSocket): void {
    this.pendingSubs.clear();
    for (const channel of Array.from(this.channelSymbols.keys()).slice(0, 60)) {
      const id = this.nextId++;
      this.pendingSubs.set(id, channel);
      socket.send(JSON.stringify({ id, subscribe: { channel } }));
    }
  }

  private routePublication(channel: string, data: Record<string, unknown>, receivedAt: number): void {
    const symbol = this.channelSymbols.get(channel);
    if (!symbol) return;
    if (!channel.startsWith("orderbook:")) return;
    // اسنپ‌شات اردربوک: { buys:[[قیمت,مقدار]...], sells:[...], lastTradePrice }
    const price = finite(data.lastTradePrice) ?? bestPrice(data);
    this.callbacks.onMarket({ symbol, price, receivedAt });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt - 1, 5));
    this.setState({ status: "reconnecting" });
    this.reconnectTimer = setTimeout(() => void this.open(true), delay);
  }

  private setState(patch: Partial<NobitexSocketState>): void {
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (this.state.status !== previous.status || this.state.error !== previous.error) {
      console.info(
        `[ramzinex-ws] status: ${previous.status} → ${this.state.status}${this.state.error ? ` | ${this.state.error}` : ""}`,
      );
    }
    this.callbacks.onState({ ...this.state });
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z]{2,12}(IRT|IRR)$/.test(symbol))),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** اگر lastTradePrice نبود، میانگین بهترین خرید/فروش اردربوک را برگردان */
function bestPrice(data: Record<string, unknown>): number | undefined {
  const buys = Array.isArray(data.buys) ? (data.buys as unknown[]) : [];
  const sells = Array.isArray(data.sells) ? (data.sells as unknown[]) : [];
  const first = (rows: unknown[]): number | undefined => {
    const row = Array.isArray(rows[0]) ? (rows[0] as unknown[]) : null;
    return row ? finite(row[0]) : undefined;
  };
  const bid = first(buys);
  const ask = first(sells);
  if (bid !== undefined && ask !== undefined) return (bid + ask) / 2;
  return bid ?? ask;
}
