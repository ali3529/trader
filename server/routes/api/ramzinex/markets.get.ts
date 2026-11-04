import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { getPairsMap, getPairsSample } from "../../../utils/ramzinex";

/** نگاشت نماد→شناسه بازار رمزینکس برای اشتراک وب‌سوکت سمت کلاینت */
export default defineHandler(async (event) => {
  const markets = await getPairsMap();
  // اگر نگاشت خراب باشد (مثلاً همهٔ نمادها در یک کلید جمع شده باشند) → نمونهٔ خام برای تشخیص قالب
  // با ?sample=1 هم می‌توان نمونهٔ خام را گرفت (برای تشخیص اسکیمای pairs)
  if (Object.keys(markets).length >= 2 && getQuery(event).sample !== "1") return { markets };
  return { markets, sample: getPairsSample() };
});
