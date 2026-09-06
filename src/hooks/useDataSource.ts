import { useSyncExternalStore } from "react";
import { getDataSource, onDataSource, type DataSource } from "@/lib/engine/api";

/** منبع فعلی دادهٔ بازار را به‌صورت زنده برمی‌گرداند */
export function useDataSource(): DataSource {
  return useSyncExternalStore(onDataSource, getDataSource);
}
