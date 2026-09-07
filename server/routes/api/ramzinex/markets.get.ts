import { defineHandler } from "nitro";
import { getPairsMap, getPairsSample } from "../../../utils/ramzinex";

/** نگاشت نماد→شناسه بازار رمزینکس برای اشتراک وب‌سوکت سمت کلاینت */
export default defineHandler(async () => {
  const markets = await getPairsMap();
  // اگر نگاشت خراب باشد (مثلاً همهٔ نمادها در یک کلید جمع شده باشند) → نمونهٔ خام برای تشخیص قالب
  if (Object.keys(markets).length >= 2) return { markets };
  return { markets, sample: getPairsSample() };
});
