import { useEffect, useSyncExternalStore } from "react";
import {
  getDataSource,
  getExchangeProvider,
  onDataSource,
  onExchangeProvider,
  refreshExchangeProvider,
  type DataSource,
  type ExchangeProvider,
} from "@/lib/engine/api";

/** منبع فعلی دادهٔ بازار را به‌صورت زنده برمی‌گرداند */
export function useDataSource(): DataSource {
  return useSyncExternalStore(onDataSource, getDataSource);
}

/** صرافی فعال (نوبیتکس/رمزینکس) — هنگام mount از سرور خوانده می‌شود */
export function useExchangeProvider(): ExchangeProvider {
  useEffect(() => {
    void refreshExchangeProvider();
  }, []);
  return useSyncExternalStore(onExchangeProvider, getExchangeProvider);
}
