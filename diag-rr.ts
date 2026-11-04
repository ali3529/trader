import { fetchCandles as ramzinexCandles } from "./server/utils/ramzinex";
import { evaluateEntry } from "./src/lib/strategy/scoring";
import { allLevels, exitLevelsAbove, levelLower, levelUpper, nearestSupport } from "./src/lib/strategy/levels";
import { analyzeStructure } from "./src/lib/strategy/structure";
import { lastAtr } from "./src/lib/strategy/indicators";
import { DEFAULT_CONFIG } from "./src/lib/config";
import type { Candle } from "./src/lib/types";

const TF = { "15m": 15, "1h": 60, "4h": 240 } as const;
const COUNT = { "15m": 60, "1h": 90, "4h": 60 } as const;

async function closed(symbol: string, tf: keyof typeof TF): Promise<Candle[]> {
  const tfSec = TF[tf] * 60;
  const now = Date.now();
  const toSec = Math.floor(now / tfSec) * tfSec;
  const fromSec = toSec - COUNT[tf] * tfSec;
  const raw = await ramzinexCandles(symbol, TF[tf], fromSec, toSec);
  const out: Candle[] = [];
  for (let i = 0; i < raw.t.length; i++) {
    const time = raw.t[i] * 1000;
    if (time + TF[tf] * 60_000 > now) continue;
    if (!(raw.c[i] > 0)) continue;
    out.push({ time, open: raw.o[i], high: raw.h[i], low: raw.l[i], close: raw.c[i], volume: raw.v[i] });
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString("en-US");

async function main() {
  const symbols = process.argv.slice(2);
  for (const symbol of symbols) {
    const [c4, c1, c15] = await Promise.all([
      closed(symbol, "4h"),
      closed(symbol, "1h"),
      closed(symbol, "15m"),
    ]);
    const cfg = { ...DEFAULT_CONFIG };
    const signal = evaluateEntry({ symbol, candles4h: c4, candles1h: c1, candles15m: c15, cfg });
    console.log(`\n=== ${symbol} ===  (4h=${c4.length} 1h=${c1.length} 15m=${c15.length})`);
    if (!signal) {
      console.log("  evaluateEntry returned null (not enough candles / no ATR)");
      continue;
    }

    const atr1h = lastAtr(c1, cfg.atrPeriod)!;
    const entry = c1[c1.length - 1].close;
    const levels = allLevels(c1, atr1h, cfg);
    const support = nearestSupport(levels, entry);
    const exits = exitLevelsAbove(levels, entry);
    const structure = analyzeStructure(c4, cfg.swingLookback);
    const roundTripCost = entry * 2 * ((cfg.feePct + cfg.slippagePct) / 100);
    const stop = signal.stop;
    const stopDist = entry - stop;
    const netRisk = stopDist + roundTripCost;
    const rrAt = (p: number) => (netRisk > 0 ? (p - entry - roundTripCost) / netRisk : 0);

    console.log(`  entry            = ${fmt(entry)}`);
    console.log(`  atr1h            = ${fmt(atr1h)}  (${((atr1h / entry) * 100).toFixed(2)}% of price)`);
    console.log(`  stop             = ${fmt(stop)}   stopDist=${(stopDist / atr1h).toFixed(2)}×ATR`);
    console.log(`  roundTripCost    = ${fmt(roundTripCost)}  (${((roundTripCost / entry) * 100).toFixed(2)}% of price)`);
    console.log(`  netRisk          = ${fmt(netRisk)}  cost eats ${((roundTripCost / netRisk) * 100).toFixed(1)}% of risk`);
    console.log(`  support          = ${support ? fmt(levelLower(support)) + " .. " + fmt(levelUpper(support)) + " (" + support.kind + ")" : "none"}`);
    console.log(`  4h swing H/L     = ${structure.lastSwingHigh ? fmt(structure.lastSwingHigh) : "null"} / ${structure.lastSwingLow ? fmt(structure.lastSwingLow) : "null"}`);
    const measuredMove = structure.lastSwingHigh !== null && structure.lastSwingLow !== null
      ? Math.abs(structure.lastSwingHigh - structure.lastSwingLow)
      : 0;
    console.log(`  measuredMove     = ${fmt(measuredMove)}  → projected target ${fmt(entry + measuredMove)} = ${rrAt(entry + measuredMove).toFixed(2)}R`);
    console.log(`  exit levels above (${exits.length}):`);
    for (const l of exits.slice(0, 8)) {
      console.log(`     ${l.kind}${l.side ? "/" + l.side : ""}  ${fmt(levelLower(l))} .. ${fmt(levelUpper(l))}  = ${rrAt(levelLower(l)).toFixed(2)}R`);
    }
    console.log(`  signal target    = ${fmt(signal.target)} = ${rrAt(signal.target).toFixed(2)}R   (rr field=${signal.rr.toFixed(2)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
