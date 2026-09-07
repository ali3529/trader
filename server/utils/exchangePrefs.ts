import { loadSecureState, saveSecureState } from "./nobitex";

/** صرافی فعال برای داده بازار و معامله واقعی — پیش‌فرض نوبیتکس */
export type ExchangeProvider = "nobitex" | "ramzinex";

const PREFS_FILE = "exchange-prefs.json";

export function getExchangeProvider(): ExchangeProvider {
  const stored = loadSecureState<{ provider?: string }>(PREFS_FILE, {});
  return stored.provider === "ramzinex" ? "ramzinex" : "nobitex";
}

export function setExchangeProvider(provider: ExchangeProvider): void {
  saveSecureState(PREFS_FILE, { provider });
}
