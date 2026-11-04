import { defineHandler } from "nitro";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";
import { fetchTelegramChatIds } from "../../../utils/telegram";

/** لیست گفتگوهای اخیر ربات برای پیدا کردن خودکار chat_id */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  return { chats: await fetchTelegramChatIds() };
});
