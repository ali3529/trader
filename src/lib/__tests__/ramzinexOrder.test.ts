import { describe, expect, it } from "vitest";
import { normalizeOrder } from "../../../server/utils/ramzinex";
import { hasUnresolvedOrder, type BotOrderRecord } from "../../../server/utils/orderLedger";

describe("نرمال‌سازی سفارش رمزینکس", () => {
  it("مقدار fill جزئی را از نام‌های مختلف پاسخ API حفظ می‌کند", () => {
    const order = normalizeOrder({
      id: 42,
      pair_id: 11,
      type_en: "buy",
      order_price_nr: 1_000_000,
      amount_nr: 2,
      filled_amount_nr: 0.75,
      status_id: 4,
    });

    expect(order.id).toBe(42);
    expect(order.side).toBe("buy");
    expect(order.filled).toBe(0.75);
    expect(order.status).toBe("partial");
  });

  it("فیلد matched_amount را نیز به‌عنوان fill نهایی می‌خواند", () => {
    expect(normalizeOrder({ id: 43, type: "sell", matched_amount: "1.25", status_id: 3 }).filled).toBe(1.25);
  });
});

describe("قفل سفارش مبهم", () => {
  const record: BotOrderRecord = {
    orderId: 10,
    clientOrderId: "test-order-10",
    symbol: "BTCIRT",
    side: "buy",
    requestedQty: 0.1,
    filledQty: 0,
    averagePrice: 0,
    status: "unknown",
    reconciliationRequired: true,
    createdAt: 1,
    positionId: "BTCIRT-test",
  };

  it("ارسال دوباره همان نماد را برای IRT و IRR مسدود می‌کند", () => {
    expect(hasUnresolvedOrder([record], "BTCIRT")).toBe(true);
    expect(hasUnresolvedOrder([record], "BTCIRR")).toBe(true);
    expect(hasUnresolvedOrder([record], "ETHIRT")).toBe(false);
  });
});
