// ابزار تشخیص: موتور امتیازدهی ورود را روی دادهٔ زندهٔ رمزینکس اجرا می‌کند
// تا مشخص شود کدام یک از ۸ معیار مانع ورود هستند. فقط خواندن/تحلیل است.
import { fetchCandles as ramzinexCandles } from "./server/utils/ramzinex";
import { evaluateEntry } from "./src/lib/strategy/scoring";
import { DEFAULT_CONFIG } from "./src/lib/config";
import type { Candle } from "./src/lib/types";

const TF = { "15m": 15, "1h": 60, "4h": 240 } as const;
const COUNT = { "15m": 60, "1h": 90, "4h": 60 } as const;

async function closed(symbol: string, tf: keyof typeof TF): Promise<Candle[]> {
  const minutes = TF[tf];
  const ms = minutes * 60_000;
  const tfSec = ms / 1000;
  const nowMs = Date.now();
  const toSec = Math.floor(nowMs / 1000 / tfSec) * tfSec;
  const fromSec = toSec - COUNT[tf] * tfSec;
  const rz = await ramzinexCandles(symbol, minutes, fromSec, toSec);
  const candles = rz.t.map((t, i) => ({
    time: t * 1000,
    open: Number(rz.o[i] ?? 0),
    high: Number(rz.h[i] ?? 0),
    low: Number(rz.l[i] ?? 0),
    close: Number(rz.c[i] ?? 0),
    volume: Number(rz.v?.[i] ?? 0),
  }));
  return candles.filter((c) => c.time + ms <= nowMs && c.close > 0);
}

async function main() {
  const symbols = (process.argv.slice(2).length ? process.argv.slice(2) : ["BTCIRR", "ETHIRR", "SOLIRR", "TRXIRR"]);
  const cfg = { ...DEFAULT_CONFIG, minConfirmations: 1 }; // آستانه را پایین می‌آوریم تا همهٔ معیارها دیده شوند
  for (const symbol of symbols) {
    try {
      const [c15, c1h, c4h] = await Promise.all([
        closed(symbol, "15m"),
        closed(symbol, "1h"),
        closed(symbol, "4h"),
      ]);
      const signal = evaluateEntry({ symbol, candles4h: c4h, candles1h: c1h, candles15m: c15, cfg });
      console.log(`\n=== ${symbol} (${c4h.length}×4h ${c1h.length}×1h ${c15.length}×15m) ===`);
      if (!signal) {
        console.log("  سیگنالی ساخته نشد — داده کافی نیست");
        continue;
      }
      console.log(`  امتیاز: ${signal.score}/۸  qualified=${signal.qualified}`);
      for (const c of signal.criteria) {
        const flag = c.passed ? "✓" : "✗";
        const crit = c.critical ? "[حیاتی]" : "         ";
        console.log(`  ${flag} ${crit} ${c.label.padEnd(24)} — ${c.detail}`);
      }
    } catch (error) {
      console.log(`\n=== ${symbol} === خطا: ${(error as Error).message}`);
    }
  }
}

void main();
