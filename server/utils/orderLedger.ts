import { loadSecureState, saveSecureState } from "./nobitex";

const LEDGER_FILE = "orders.enc.json";
const MAX_RECORDS = 2_000;

export interface BotOrderRecord {
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

export function loadOrderLedger(): BotOrderRecord[] {
  const records = loadSecureState<BotOrderRecord[]>(LEDGER_FILE, []);
  return Array.isArray(records) ? records.filter(validRecord).slice(-MAX_RECORDS) : [];
}

export function recordBotOrder(record: BotOrderRecord): void {
  const records = loadOrderLedger().filter((item) => item.orderId !== record.orderId);
  records.push(record);
  saveSecureState(LEDGER_FILE, records.slice(-MAX_RECORDS));
}

function validRecord(record: BotOrderRecord): boolean {
  return Boolean(
    record &&
    Number.isInteger(record.orderId) &&
    record.orderId > 0 &&
    /^[A-Z]{2,12}IRT$/.test(record.symbol) &&
    (record.side === "buy" || record.side === "sell") &&
    Number.isFinite(record.filledQty) &&
    Number.isFinite(record.averagePrice),
  );
}
