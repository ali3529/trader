import { readState, writeState } from "./stateStore";

/** صرافی فعال برای داده بازار و معامله واقعی — پیش‌فرض نوبیتکس */
export type ExchangeProvider = "nobitex" | "ramzinex";

const PREFS_FILE = "exchange-prefs.json";

export async function getExchangeProvider(): Promise<ExchangeProvider> {
  const stored = await readState<{ provider?: string }>(PREFS_FILE, {});
  return stored.provider === "ramzinex" ? "ramzinex" : "nobitex";
}

export async function setExchangeProvider(provider: ExchangeProvider): Promise<void> {
  await writeState(PREFS_FILE, { provider });
}
