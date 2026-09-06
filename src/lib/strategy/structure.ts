import type { Candle, MarketStructure, StructureEvent, SwingPoint, SwingKind } from "../types";
import { swingPoints } from "./indicators";

/**
 * ساختار بازار در تایم‌فریم ۴ ساعته:
 * HH/HL = روند صعودی، LH/LL = نزولی، BOS = شکست ساختار در جهت روند،
 * CHoCH = اولین تغییر جهت ساختار.
 */
export function analyzeStructure(candles: Candle[], lookback = 2): MarketStructure {
  const swings = swingPoints(candles, lookback);
  const labeled: SwingPoint[] = [];
  const events: MarketStructure["events"] = [];

  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  let trend: "up" | "down" | "range" = "range";
  let lastEvent: StructureEvent | null = null;

  for (const s of swings) {
    let kind: SwingKind;
    if (s.type === "high") {
      kind = lastHigh === null ? "HH" : s.price > lastHigh.price ? "HH" : "LH";
      const point: SwingPoint = { index: s.index, price: s.price, time: candles[s.index].time, kind };
      labeled.push(point);
      if (lastHigh) {
        const evt = classifyBreak(point, trend);
        if (evt) {
          events.push({ index: s.index, time: candles[s.index].time, type: evt });
          lastEvent = evt;
          trend = evt === "BOS_UP" || evt === "CHOCH_UP" ? "up" : "down";
        }
      }
      lastHigh = point;
    } else {
      kind = lastLow === null ? "HL" : s.price > lastLow.price ? "HL" : "LL";
      const point: SwingPoint = { index: s.index, price: s.price, time: candles[s.index].time, kind };
      labeled.push(point);
      if (lastLow) {
        const evt = classifyLowBreak(point, trend);
        if (evt) {
          events.push({ index: s.index, time: candles[s.index].time, type: evt });
          lastEvent = evt;
          trend = evt === "BOS_UP" || evt === "CHOCH_UP" ? "up" : "down";
        }
      }
      lastLow = point;
    }
  }

  // روند جاری از دو swing آخر هر نوع
  if (lastHigh && lastLow) {
    const hhhl = lastHigh.kind === "HH" && lastLow.kind === "HL";
    const lhll = lastHigh.kind === "LH" && lastLow.kind === "LL";
    if (hhhl) trend = "up";
    else if (lhll) trend = "down";
    else if (trend === "range" && !lastEvent) trend = "range";
  }

  return {
    trend,
    swings: labeled,
    events,
    lastEvent,
    lastSwingHigh: lastHigh?.price ?? null,
    lastSwingLow: lastLow?.price ?? null,
  };
}

function classifyBreak(h: SwingPoint, trend: string): StructureEvent | null {
  if (h.kind !== "HH") return null;
  return trend === "down" || trend === "range" ? "CHOCH_UP" : "BOS_UP";
}

function classifyLowBreak(l: SwingPoint, trend: string): StructureEvent | null {
  if (l.kind !== "LL") return null;
  return trend === "up" || trend === "range" ? "CHOCH_DOWN" : "BOS_DOWN";
}

/** آیا ساختار ۴ ساعته برای ورود خرید معتبر است؟ */
export function isBullishStructure(m: MarketStructure): boolean {
  if (m.trend !== "up") return false;
  return m.lastEvent === "BOS_UP" || m.lastEvent === "CHOCH_UP";
}

/** CHoCH نزولی اخیر (برای خروج اضطراری) */
export function hasRecentBearishChoch(m: MarketStructure, withinBars = 6): boolean {
  const idx = m.events.map((e) => e);
  const last = idx[idx.length - 1];
  if (!last) return false;
  if (last.type !== "CHOCH_DOWN") return false;
  const lastSwingIndex = m.swings.length ? m.swings[m.swings.length - 1].index : last.index;
  return lastSwingIndex - last.index <= withinBars;
}
