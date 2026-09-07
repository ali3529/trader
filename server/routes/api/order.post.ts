import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";
import { privateRequest, loadKeys, assertValidSymbol } from "../../utils/nobitex";
import { assertSensitiveRequest } from "../../utils/requestSecurity";
import { recordBotOrder } from "../../utils/orderLedger";
import { getExchangeProvider } from "../../utils/exchangePrefs";
import {
  cancelOrder as rzCancelOrder,
  fetchAccount as rzFetchAccount,
  loadRamzinexKeys,
  orderStatus as rzOrderStatus,
  placeOrder as rzPlaceOrder,
  type RzOrder,
} from "../../utils/ramzinex";

interface Body {
  symbol?: string;
  side?: "buy" | "sell";
  type?: "market" | "limit";
  qty?: number;
  price?: number;
  stop?: number;
  clientOrderId?: string;
  positionId?: string;
  target?: number;
  rr?: number;
  atr?: number;
  signalTime?: number;
  signalScore?: number;
  reason?: string;
}

interface NobitexOrder {
  id?: number;
  status?: string;
  matchedAmount?: string | number;
  averagePrice?: string | number;
  price?: string | number;
  clientOrderId?: string | null;
}

const MIN_ORDER_TOMAN = Math.max(1, Number(process.env.TRADEBAN_MIN_ORDER_TOMAN) || 300_000);
const MAX_RISK_PCT = Math.min(1, Math.max(0.01, Number(process.env.TRADEBAN_MAX_RISK_PCT) || 1));
const MAX_ENGAGED_PCT = Math.min(12, Math.max(0.1, Number(process.env.TRADEBAN_MAX_ENGAGED_PCT) || 12));
const MAX_OPEN_ORDERS = Math.min(4, Math.max(1, Number(process.env.TRADEBAN_MAX_OPEN_ORDERS) || 4));
let orderQueue: Promise<unknown> = Promise.resolve();

/**
 * ثبت سفارش اسپات طبق مستندات فعلی نوبیتکس (POST /market/orders/add).
 * فقط اگر معامله واقعی با تأیید روشن کاربر فعال شده باشد.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event, { mutation: true });
  const body = await readBody<Body>(event);
  const operation = orderQueue.then(() => submitOrder(body));
  orderQueue = operation.catch(() => undefined);
  return operation;
});

async function submitOrder(body: Body) {
  if (getExchangeProvider() === "ramzinex") return submitRamzinexOrder(body);
  const keys = loadKeys();
  if (!keys || !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی فعال نیست" });
  }
  const symbol = assertValidSymbol(String(body?.symbol ?? "").toUpperCase());
  const srcCurrency = symbol.slice(0, -3).toLowerCase();
  const dstCurrency = "rls";
  const type = body?.side === "sell" ? "sell" : body?.side === "buy" ? "buy" : null;
  if (!type) throw createError({ statusCode: 400, statusMessage: "side نامعتبر" });
  const quantity = Number(body?.qty);
  if (!isFinite(quantity) || quantity <= 0) throw createError({ statusCode: 400, statusMessage: "qty نامعتبر" });
  const clientOrderId = String(body?.clientOrderId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientOrderId)) {
    throw createError({ statusCode: 400, statusMessage: "clientOrderId معتبر و یکتا الزامی است" });
  }
  const positionId = String(body?.positionId ?? "").trim();
  if (!/^[A-Z0-9_-]{8,80}$/i.test(positionId)) {
    throw createError({ statusCode: 400, statusMessage: "positionId معتبر الزامی است" });
  }

  const estimatedPriceToman = Number(body?.price);
  if (!isFinite(estimatedPriceToman) || estimatedPriceToman <= 0) {
    throw createError({ statusCode: 400, statusMessage: "قیمت تخمینی معتبر الزامی است" });
  }

  await assertServerRisk({ symbol, side: type, quantity, priceToman: estimatedPriceToman, stopToman: Number(body?.stop) });

  const execution = body?.type === "limit" ? "limit" : "market";
  const order: Record<string, unknown> = {
    type,
    srcCurrency,
    dstCurrency,
    amount: String(quantity),
    execution,
    clientOrderId,
  };
  if (execution === "limit") {
    const price = Number(body?.price);
    if (!isFinite(price) || price <= 0) throw createError({ statusCode: 400, statusMessage: "price نامعتبر" });
    order.price = String(toRial(price));
  } else if (estimatedPriceToman > 0) {
    // نوبیتکس ارسال تخمین قیمت را برای محدودکردن لغزش سفارش Market توصیه می‌کند.
    // قیمت بازارهای ریالی در API سفارش نوبیتکس به ریال است؛ UI تریدبان تومان است.
    order.price = String(toRial(estimatedPriceToman));
  }

  const result = (await privateRequest("POST", "/market/orders/add", { body: order })) as {
    order?: NobitexOrder;
  };
  if (!result.order?.id) throw createError({ statusCode: 502, statusMessage: "نوبیتکس شناسه سفارش برنگرداند" });

  // ثبت سفارش الزاماً fill نیست. پس از فاصله اجباری API وضعیت واقعی را می‌خوانیم.
  let confirmed = result.order;
  let reconciliationRequired = true;
  try {
    const status = await privateRequest("POST", "/market/orders/status", {
      body: { id: result.order.id },
      retryable: true,
    }) as { order?: NobitexOrder };
    if (status.order) {
      confirmed = status.order;
      const state = String(confirmed.status ?? "").toLowerCase();
      if (state === "active" || state === "inactive" || state === "new") {
        await privateRequest("POST", "/market/orders/update-status", {
          body: { order: result.order.id, status: "canceled" },
          retryable: true,
        });
        const afterCancel = await privateRequest("POST", "/market/orders/status", {
          body: { id: result.order.id },
          retryable: true,
        }) as { order?: NobitexOrder };
        if (afterCancel.order) confirmed = afterCancel.order;
      }
      const finalState = String(confirmed.status ?? "").toLowerCase();
      reconciliationRequired = finalState !== "done" && finalState !== "canceled";
    }
  } catch {
    // سفارش قبلاً ثبت شده است؛ در ابهام هرگز دوباره آن را ارسال نمی‌کنیم.
  }
  const response = {
    ok: true,
    orderId: result.order.id,
    clientOrderId: confirmed.clientOrderId ?? clientOrderId,
    orderStatus: confirmed.status ?? result.order.status ?? "Unknown",
    // در وضعیت مبهم، مرورگر مجاز نیست بر اساس مقدار احتمالی دفتر محلی را تغییر دهد.
    filledQuantity: reconciliationRequired ? 0 : Number(confirmed.matchedAmount ?? 0) || 0,
    averagePrice: toToman(Number(confirmed.averagePrice ?? confirmed.price ?? 0)),
    reconciliationRequired,
  };
  recordBotOrder({
    orderId: result.order.id,
    clientOrderId: response.clientOrderId,
    symbol,
    side: type,
    requestedQty: quantity,
    filledQty: response.filledQuantity,
    averagePrice: response.averagePrice,
    status: response.orderStatus,
    reconciliationRequired,
    createdAt: Date.now(),
    positionId,
    stop: finitePositive(body.stop),
    target: finitePositive(body.target),
    rr: finitePositive(body.rr),
    atr: finitePositive(body.atr),
    signalTime: finitePositive(body.signalTime),
    signalScore: finitePositive(body.signalScore),
    reason: String(body.reason ?? "").slice(0, 120),
  });
  return response;
}

async function assertServerRisk(input: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  priceToman: number;
  stopToman: number;
}): Promise<void> {
  const [walletResponse, orderResponse] = await Promise.all([
    privateRequest("GET", "/v2/wallets", { query: { type: "spot" } }),
    privateRequest("GET", "/market/orders/list", { query: { status: "open", details: "2" } }),
  ]) as [
    { wallets?: Record<string, { balance?: string | number; blocked?: string | number }> },
    { orders?: Array<Record<string, unknown>> },
  ];
  const wallets = walletResponse.wallets ?? {};
  const openOrders = orderResponse.orders ?? [];

  const baseCoin = input.symbol.slice(0, -3);
  if (input.side === "sell") {
    const wallet = wallets[baseCoin] ?? wallets[baseCoin.toLowerCase()];
    const available = Math.max(0, Number(wallet?.balance ?? 0) - Number(wallet?.blocked ?? 0));
    if (input.quantity > available) {
      throw createError({ statusCode: 409, statusMessage: "مقدار فروش از موجودی آزاد صرافی بیشتر است" });
    }
    return;
  }

  if (openOrders.length >= MAX_OPEN_ORDERS) {
    throw createError({ statusCode: 409, statusMessage: `سقف امن ${MAX_OPEN_ORDERS} سفارش باز تکمیل است` });
  }

  if (!isFinite(input.stopToman) || input.stopToman <= 0 || input.stopToman >= input.priceToman) {
    throw createError({ statusCode: 400, statusMessage: "برای خرید واقعی Stop معتبر و پایین‌تر از ورود الزامی است" });
  }
  const rialWallet = wallets.RLS ?? wallets.rls ?? wallets.IRR ?? wallets.irr;
  const totalToman = Number(rialWallet?.balance ?? 0) / 10;
  const availableToman = Math.max(0, totalToman - Number(rialWallet?.blocked ?? 0) / 10);
  const notionalToman = input.quantity * input.priceToman;
  if (notionalToman < MIN_ORDER_TOMAN) {
    throw createError({ statusCode: 409, statusMessage: `ارزش سفارش کمتر از حداقل امن ${MIN_ORDER_TOMAN.toLocaleString("fa-IR")} تومان است` });
  }
  if (notionalToman > availableToman) {
    throw createError({ statusCode: 409, statusMessage: "ارزش سفارش از موجودی آزاد ریالی بیشتر است" });
  }
  const riskToman = input.quantity * (input.priceToman - input.stopToman);
  if (riskToman > totalToman * (MAX_RISK_PCT / 100)) {
    throw createError({ statusCode: 409, statusMessage: `ریسک سفارش از سقف سرور (${MAX_RISK_PCT}٪) بیشتر است` });
  }
  const engagedToman = openOrders.reduce((sum, item) => {
    if (String(item.type ?? "").toLowerCase() !== "buy") return sum;
    return sum + Number(item.amount ?? 0) * toToman(Number(item.price ?? 0));
  }, 0);
  if (engagedToman + notionalToman > totalToman * (MAX_ENGAGED_PCT / 100)) {
    throw createError({ statusCode: 409, statusMessage: `سرمایه درگیر از سقف سرور (${MAX_ENGAGED_PCT}٪) بیشتر می‌شود` });
  }
}

function toRial(toman: number): number {
  return Math.round(toman * 10);
}

function toToman(rial: number): number {
  return Number.isFinite(rial) ? rial / 10 : 0;
}

function finitePositive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * ثبت سفارش واقعی روی رمزینکس (limit: /users/me/orders/limit ، market: v2 /users/me/orders/market).
 * همان سقف‌های ریسک سرور با دارایی‌های رمزینکس اعمال می‌شود.
 */
async function submitRamzinexOrder(body: Body) {
  const keys = loadRamzinexKeys();
  if (!keys || !keys.realEnabled) {
    throw createError({ statusCode: 403, statusMessage: "معامله واقعی رمزینکس فعال نیست" });
  }
  const symbol = assertValidSymbol(String(body?.symbol ?? "").toUpperCase());
  const type = body?.side === "sell" ? "sell" : body?.side === "buy" ? "buy" : null;
  if (!type) throw createError({ statusCode: 400, statusMessage: "side نامعتبر" });
  const quantity = Number(body?.qty);
  if (!isFinite(quantity) || quantity <= 0) throw createError({ statusCode: 400, statusMessage: "qty نامعتبر" });
  const clientOrderId = String(body?.clientOrderId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientOrderId)) {
    throw createError({ statusCode: 400, statusMessage: "clientOrderId معتبر و یکتا الزامی است" });
  }
  const positionId = String(body?.positionId ?? "").trim();
  if (!/^[A-Z0-9_-]{8,80}$/i.test(positionId)) {
    throw createError({ statusCode: 400, statusMessage: "positionId معتبر الزامی است" });
  }
  const estimatedPriceToman = Number(body?.price);
  if (!isFinite(estimatedPriceToman) || estimatedPriceToman <= 0) {
    throw createError({ statusCode: 400, statusMessage: "قیمت تخمینی معتبر الزامی است" });
  }

  const account = await rzFetchAccount();
  const openOrders = account.openOrders as unknown as RzOrder[];
  const baseCoin = symbol.slice(0, -3);
  if (type === "sell") {
    const available = Math.max(0, account.balances[baseCoin] ?? 0);
    if (quantity > available) {
      throw createError({ statusCode: 409, statusMessage: "مقدار فروش از موجودی آزاد رمزینکس بیشتر است" });
    }
  } else {
    if (openOrders.length >= MAX_OPEN_ORDERS) {
      throw createError({ statusCode: 409, statusMessage: `سقف امن ${MAX_OPEN_ORDERS} سفارش باز تکمیل است` });
    }
    const stopToman = Number(body?.stop);
    if (!isFinite(stopToman) || stopToman <= 0 || stopToman >= estimatedPriceToman) {
      throw createError({ statusCode: 400, statusMessage: "برای خرید واقعی Stop معتبر و پایین‌تر از ورود الزامی است" });
    }
    const rialTotal = account.totalBalances.IRR ?? 0;
    const rialBlocked = account.blockedBalances.IRR ?? 0;
    const totalToman = rialTotal / 10;
    const availableToman = Math.max(0, totalToman - rialBlocked / 10);
    const notionalToman = quantity * estimatedPriceToman;
    if (notionalToman < MIN_ORDER_TOMAN) {
      throw createError({ statusCode: 409, statusMessage: `ارزش سفارش کمتر از حداقل امن ${MIN_ORDER_TOMAN.toLocaleString("fa-IR")} تومان است` });
    }
    if (notionalToman > availableToman) {
      throw createError({ statusCode: 409, statusMessage: "ارزش سفارش از موجودی آزاد ریالی رمزینکس بیشتر است" });
    }
    const riskToman = quantity * (estimatedPriceToman - stopToman);
    if (riskToman > totalToman * (MAX_RISK_PCT / 100)) {
      throw createError({ statusCode: 409, statusMessage: `ریسک سفارش از سقف سرور (${MAX_RISK_PCT}٪) بیشتر است` });
    }
    const engagedToman = openOrders.reduce((sum, item) => {
      if (item.side !== "buy") return sum;
      return sum + item.qty * (item.price / 10);
    }, 0);
    if (engagedToman + notionalToman > totalToman * (MAX_ENGAGED_PCT / 100)) {
      throw createError({ statusCode: 409, statusMessage: `سرمایه درگیر از سقف سرور (${MAX_ENGAGED_PCT}٪) بیشتر می‌شود` });
    }
  }

  const execution = body?.type === "limit" ? "limit" : "market";
  const orderId = await rzPlaceOrder(symbol, type, execution, quantity, estimatedPriceToman);

  // ثبت سفارش الزاماً fill نیست؛ وضعیت واقعی خوانده و اگر باز ماند لغو می‌شود (مانند نوبیتکس).
  let confirmed = await rzOrderStatus(orderId);
  let reconciliationRequired = true;
  try {
    if (confirmed.statusId === 1) {
      await rzCancelOrder(orderId);
      confirmed = await rzOrderStatus(orderId);
    }
    reconciliationRequired = confirmed.statusId !== 2 && confirmed.statusId !== 3;
  } catch {
    // سفارش ثبت شده است؛ در ابهام هرگز دوباره ارسال نمی‌کنیم.
  }
  const terminal = confirmed.statusId === 2 || confirmed.statusId === 3;
  const response = {
    ok: true,
    orderId,
    clientOrderId,
    orderStatus: confirmed.status,
    filledQuantity: terminal ? confirmed.filled : 0,
    averagePrice: toToman(confirmed.averagePrice || confirmed.price),
    reconciliationRequired,
  };
  recordBotOrder({
    orderId,
    clientOrderId,
    symbol,
    side: type,
    requestedQty: quantity,
    filledQty: response.filledQuantity,
    averagePrice: response.averagePrice,
    status: confirmed.status,
    reconciliationRequired,
    createdAt: Date.now(),
    positionId,
    stop: finitePositive(body.stop),
    target: finitePositive(body.target),
    rr: finitePositive(body.rr),
    atr: finitePositive(body.atr),
    signalTime: finitePositive(body.signalTime),
    signalScore: finitePositive(body.signalScore),
    reason: String(body.reason ?? "").slice(0, 120),
  });
  return response;
}
