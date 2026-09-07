export type NobitexSocketStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface RealtimeMarketUpdate {
  symbol: string;
  price?: number;
  changePct24h?: number;
  volume24h?: number;
  receivedAt: number;
}

export interface NobitexSocketState {
  status: NobitexSocketStatus;
  privateEnabled: boolean;
  lastMessageAt: number | null;
  error: string | null;
}

interface WsConfig {
  wsUrl: string;
  privateEnabled: boolean;
  token: string | null;
  websocketAuthParam: string | null;
  expiresIn?: number;
  disabled?: boolean;
}

interface SocketCallbacks {
  onState: (state: NobitexSocketState) => void;
  onMarket: (update: RealtimeMarketUpdate) => void;
  onPrivateEvent: (kind: "order" | "trade", data: Record<string, unknown>) => void;
}

const PROD_WS = "wss://ws.nobitex.ir/connection/websocket";
const TESTNET_WS = "wss://testnetws.nobitex.ir/connection/websocket";
const CONFIG_BUDGET_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ws-config timeout")), ms)),
  ]);
}

/**
 * Minimal Centrifugo JSON-protocol client. We intentionally do not request
 * Fossil deltas: native WebSocket does not include the SDK's delta decoder.
 */
export class NobitexWebSocket {
  private socket: WebSocket | null = null;
  private symbols: string[] = [];
  private callbacks: SocketCallbacks;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 2;
  private privateEnabled = false;
  private authParam: string | null = null;
  private pendingSubs = new Map<number, string>();
  private state: NobitexSocketState = {
    status: "idle",
    privateEnabled: false,
    lastMessageAt: null,
    error: null,
  };

  constructor(callbacks: SocketCallbacks) {
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

  private async loadConfig(): Promise<WsConfig> {
    // وقتی صرافی فعال رمزینکس است، سوکت نوبیتکس خاموش می‌ماند (اسکن روی کندل بسته ادامه دارد).
    try {
      const exchangeResponse = await fetch("/api/exchange", { cache: "no-store" });
      if (exchangeResponse.ok) {
        const data = await exchangeResponse.json() as { provider?: string };
        if (data.provider === "ramzinex") {
          return { wsUrl: "", privateEnabled: false, token: null, websocketAuthParam: null, disabled: true };
        }
      }
    } catch {
      // نبود اطلاعات → مسیر پیش‌فرض نوبیتکس
    }
    let sandbox = false;
    let configured = false;
    try {
      const keyResponse = await fetch("/api/keys");
      const keyState = await keyResponse.json() as { configured?: boolean; sandbox?: boolean };
      configured = keyState.configured === true;
      sandbox = keyState.sandbox === true;
    } catch {
      // Public stream can still be attempted.
    }
    if (!configured) {
      return {
        wsUrl: sandbox ? TESTNET_WS : PROD_WS,
        privateEnabled: false,
        token: null,
        websocketAuthParam: null,
      };
    }
    // سوکت هرگز نباید معطل اعتبارنامهٔ خصوصی بماند: بودجهٔ ۸ ثانیه، بعد فقط جریان عمومی
    let response: Response;
    try {
      response = await withTimeout(fetch("/api/nobitex/ws-config", { cache: "no-store" }), CONFIG_BUDGET_MS);
    } catch {
      console.info("[nobitex-ws] ws-config slow/unavailable — connecting public-only");
      return {
        wsUrl: sandbox ? TESTNET_WS : PROD_WS,
        privateEnabled: false,
        token: null,
        websocketAuthParam: null,
      };
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { statusMessage?: string; message?: string } | null;
      throw new Error(body?.statusMessage ?? body?.message ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<WsConfig>;
  }

  private async open(reconnecting: boolean): Promise<void> {
    if (this.stopped) return;
    this.setState({
      status: reconnecting ? "reconnecting" : "connecting",
      error: null,
    });

    let config: WsConfig;
    try {
      config = await this.loadConfig();
    } catch (error) {
      // Invalid/missing READ permission must not disable public market streams.
      this.setState({ error: `احراز هویت خصوصی: ${(error as Error).message}` });
      config = { wsUrl: PROD_WS, privateEnabled: false, token: null, websocketAuthParam: null };
    }
    if (this.stopped) return;
    if (config.disabled) {
      console.info("[nobitex-ws] disabled — صرافی فعال نوبیتکس نیست");
      this.setState({ status: "idle", privateEnabled: false, error: null });
      return;
    }

    this.privateEnabled = config.privateEnabled;
    this.authParam = config.websocketAuthParam;
    console.info(`[nobitex-ws] opening ${config.wsUrl} (private:${config.privateEnabled})`);
    const socket = new WebSocket(config.wsUrl || PROD_WS);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      console.info("[nobitex-ws] tcp/tls open — sending connect command");
      socket.send(JSON.stringify({ id: 1, connect: config.token ? { token: config.token } : {} }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      for (const line of event.data.split("\n").filter(Boolean)) this.handleMessage(socket, line);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      console.info("[nobitex-ws] socket error event (network/DNS/origin block?)");
      this.setState({ status: "error", error: "خطای اتصال WebSocket نوبیتکس" });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      console.info(`[nobitex-ws] closed code=${event.code} reason=${event.reason || "—"}`);
      this.socket = null;
      this.clearRefreshTimer();
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

    if (Object.keys(message).length === 0) {
      socket.send("{}");
      return;
    }

    if (message.id === 1 && message.connect) {
      this.reconnectAttempt = 0;
      this.setState({ status: "connected", privateEnabled: this.privateEnabled, error: this.state.error });
      this.subscribe(socket);
      if (this.privateEnabled) {
        // Refresh shortly before the documented 1200-second token lifetime.
        this.refreshTimer = setTimeout(() => this.restart(), 19 * 60 * 1000);
      }
      return;
    }

    const push = asRecord(message.push);
    const publication = asRecord(push?.pub);
    if (push?.channel && publication?.data !== undefined) {
      const data = parseData(publication.data);
      if (!data) return;
      const now = Date.now();
      this.setState({ lastMessageAt: now });
      this.routePublication(String(push.channel), data, now);
      return;
    }

    const disconnect = asRecord(message.disconnect);
    if (disconnect) {
      console.info(
        `[nobitex-ws] server disconnect code=${String(disconnect.code)} reason=${String(disconnect.reason ?? "")}`,
      );
      return;
    }

    const error = asRecord(message.error);
    if (error) {
      const commandId = typeof message.id === "number" ? message.id : null;
      const channel = commandId !== null ? this.pendingSubs.get(commandId) : undefined;
      if (channel) {
        // خطای یک کانال (مثلاً نام کانال نامعتبر) نباید کل اتصال را خطا نشان دهد
        this.pendingSubs.delete(commandId as number);
        console.info(
          `[nobitex-ws] subscribe failed: ${channel} | ${String(error.message ?? error.code ?? "")}`,
        );
        return;
      }
      const detail = String(error.message ?? error.code ?? "WebSocket protocol error");
      this.setState({ status: "error", error: detail });
    }
  }

  private subscribe(socket: WebSocket): void {
    const channels: string[] = [];
    for (const symbol of this.symbols) {
      channels.push(
        `public:orderbook-${symbol}`,
        `public:trades-${symbol}`,
        `public:market-stats-${symbol}`,
        `public:candle-${symbol}-15`,
        `public:candle-${symbol}-60`,
        `public:candle-${symbol}-240`,
      );
    }
    if (this.privateEnabled && this.authParam) {
      channels.push(`private:orders#${this.authParam}`, `private:trades#${this.authParam}`);
    }
    this.pendingSubs.clear();
    for (const channel of channels.slice(0, 450)) {
      const id = this.nextId++;
      this.pendingSubs.set(id, channel);
      socket.send(JSON.stringify({ id, subscribe: { channel } }));
    }
  }

  private routePublication(channel: string, data: Record<string, unknown>, receivedAt: number): void {
    if (channel.startsWith("private:orders#")) {
      this.callbacks.onPrivateEvent("order", data);
      return;
    }
    if (channel.startsWith("private:trades#")) {
      this.callbacks.onPrivateEvent("trade", data);
      return;
    }

    const symbol = marketSymbol(channel);
    if (!symbol) return;
    if (channel.startsWith("public:orderbook-")) {
      this.callbacks.onMarket({ symbol, price: finite(data.lastTradePrice), receivedAt });
    } else if (channel.startsWith("public:trades-")) {
      this.callbacks.onMarket({ symbol, price: finite(data.price), receivedAt });
    } else if (channel.startsWith("public:market-stats-")) {
      this.callbacks.onMarket({
        symbol,
        price: finite(data.latest),
        changePct24h: finite(data.dayChange),
        volume24h: finite(data.volumeDst),
        receivedAt,
      });
    } else if (channel.startsWith("public:candle-")) {
      this.callbacks.onMarket({ symbol, price: finite(data.c), receivedAt });
    }
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
        `[nobitex-ws] status: ${previous.status} → ${this.state.status}${this.state.error ? ` | ${this.state.error}` : ""}`,
      );
    }
    this.callbacks.onState({ ...this.state });
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearRefreshTimer();
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z]{2,12}IRT$/.test(symbol))));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function parseData(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function marketSymbol(channel: string): string | null {
  const match = channel.match(/^public:(?:orderbook|trades|market-stats|candle)-([A-Z0-9]+)(?:-(?:15|60|240))?$/);
  return match?.[1] ?? null;
}
