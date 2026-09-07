import { defineHandler } from "nitro";
import { getBotMode } from "../../utils/botMode";

/** حالت ذخیره‌شدهٔ معامله برای بازیابی پس از بارگذاری صفحه */
export default defineHandler(async () => ({ mode: await getBotMode() }));
