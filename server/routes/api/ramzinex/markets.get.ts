import { defineHandler } from "nitro";
import { getPairsMap } from "../../../utils/ramzinex";

/** نگاشت نماد→شناسه بازار رمزینکس برای اشتراک وب‌سوکت سمت کلاینت */
export default defineHandler(async () => ({ markets: await getPairsMap() }));
