import { readState, writeState } from "./stateStore";

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

export async function loadOrderLedger(): Promise<BotOrderRecord[]> {
  const records = await readState<BotOrderRecord[]>(LEDGER_FILE, []);
  return Array.isArray(records) ? records.filter(validRecord).slice(-MAX_RECORDS) : [];
}

export async function recordBotOrder(record: BotOrderRecord): Promise<void> {
  const records = (await loadOrderLedger()).filter((item) => item.orderId !== record.orderId);
  records.push(record);
  await writeState(LEDGER_FILE, records.slice(-MAX_RECORDS));
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
