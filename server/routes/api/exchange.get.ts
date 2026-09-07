import { defineHandler } from "nitro";
import { getExchangeProvider } from "../../utils/exchangePrefs";

/** صرافی فعال برای داده بازار و معامله واقعی */
export default defineHandler(async () => ({ provider: await getExchangeProvider() }));
