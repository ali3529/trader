import { loadSecureState, saveSecureState } from "./nobitex";

/**
 * حالت معاملهٔ ربات (paper/real) روی سرور نگه داشته می‌شود تا پس از refresh صفحه
 * حفظ بماند. روشن‌کردن «real» همچنان فقط از مسیر تأیید ENABLE-REAL-TRADING ممکن است
 * و این فایل صرفاً آخرین انتخاب معتبر کاربر را به خاطر می‌سپارد.
 */
const MODE_FILE = "bot-mode.json";

export type BotMode = "paper" | "real";

export function getBotMode(): BotMode {
  const stored = loadSecureState<{ mode?: string }>(MODE_FILE, {});
  return stored?.mode === "real" ? "real" : "paper";
}

export function setBotMode(mode: BotMode): void {
  saveSecureState(MODE_FILE, { mode });
}
