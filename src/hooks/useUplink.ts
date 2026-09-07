import { useSyncExternalStore } from "react";
import { getUplink, onUplink, type UplinkState } from "@/lib/engine/api";

/** وضعیت زندهٔ اتصال خصوصی به نوبیتکس (موجودی/سفارش‌ها) */
export function useUplink(): UplinkState {
  return useSyncExternalStore(onUplink, getUplink);
}
