import { readState, writeState } from "./stateStore";

/**
 * حالت معاملهٔ ربات (paper/real) در لایهٔ ذخیرهٔ متحد نگه داشته می‌شود تا پس از
 * refresh صفحه حفظ بماند. روشن‌کردن «real» همچنان فقط از مسیر تأیید
 * ENABLE-REAL-TRADING ممکن است و اینجا صرفاً آخرین انتخاب معتبر کاربر یادآوری می‌شود.
 */
const MODE_FILE = "bot-mode.json";

export type BotMode = "paper" | "real";

export async function getBotMode(): Promise<BotMode> {
  const stored = await readState<{ mode?: string }>(MODE_FILE, {});
  return stored?.mode === "real" ? "real" : "paper";
}

export async function setBotMode(mode: BotMode): Promise<void> {
  await writeState(MODE_FILE, { mode });
}
