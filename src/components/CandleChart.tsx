import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle, Position, Trade } from "../lib/types";
import { rsi } from "../lib/strategy/indicators";

interface Props {
  candles: Candle[];
  trades?: Trade[];
  position?: Position | null;
  levels?: { price: number; kind: string }[];
  height?: number;
  rsiPeriod?: number;
}

const UP = "#10B981";
const DOWN = "#F43F5E";
const BG = "#0B1220";
const GRID = "rgba(51, 65, 85, 0.25)";
const TEXT = "#94A3B8";

/** چارت کندلی سریع با پنل جداگانه RSI، نقاط ورود/خروج، Stop، اهداف و سطوح کلیدی */
export function CandleChart({ candles, trades = [], position, levels = [], height = 340, rsiPeriod = 14 }: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const mainChart = useRef<IChartApi | null>(null);
  const rsiChart = useRef<IChartApi | null>(null);
  const mainSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rsiSeries = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!mainRef.current || !rsiRef.current) return;

    const common = {
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT, fontFamily: "Vazirmatn, sans-serif" },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
      localization: { locale: "en-US" },
    };

    const mc = createChart(mainRef.current, { ...common, height, width: mainRef.current.clientWidth });
    const rc = createChart(rsiRef.current, { ...common, height: 110, width: rsiRef.current.clientWidth });
    mainChart.current = mc;
    rsiChart.current = rc;

    const cs = mc.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    mainSeries.current = cs;

    const rs = rc.addLineSeries({ color: "#38BDF8", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    rsiSeries.current = rs;
    rs.createPriceLine({ price: 70, color: "rgba(244,63,94,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "70" });
    rs.createPriceLine({ price: 30, color: "rgba(16,185,129,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "30" });

    // همگام‌سازی بازه نمایش دو پنل
    const syncFrom = (src: IChartApi, dst: IChartApi) => {
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) dst.timeScale().setVisibleLogicalRange(range);
      });
    };
    syncFrom(mc, rc);
    syncFrom(rc, mc);

    const onResize = () => {
      if (mainRef.current) mc.applyOptions({ width: mainRef.current.clientWidth });
      if (rsiRef.current) rc.applyOptions({ width: rsiRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      mc.remove();
      rc.remove();
      mainChart.current = null;
      rsiChart.current = null;
    };
  }, [height]);

  useEffect(() => {
    const cs = mainSeries.current;
    const rs = rsiSeries.current;
    if (!cs || !rs || !candles.length) return;

    const data = candles.map((c) => ({
      time: (c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    cs.setData(data);

    const rsiValues = rsi(candles, rsiPeriod);
    rs.setData(
      candles
        .map((c, idx) => ({ time: (c.time / 1000) as UTCTimestamp, value: rsiValues[idx] }))
        .filter((p) => p.value !== null) as { time: UTCTimestamp; value: number }[]
    );

    // نشانگرهای ورود/خروج معاملات
    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades.slice(-60)) {
      markers.push({
        time: (t.openedAt / 1000) as UTCTimestamp,
        position: "belowBar",
        color: UP,
        shape: "arrowUp",
        text: "ورود",
      });
      markers.push({
        time: (t.closedAt / 1000) as UTCTimestamp,
        position: "aboveBar",
        color: t.pnl >= 0 ? "#38BDF8" : DOWN,
        shape: "arrowDown",
        text: t.pnl >= 0 ? "سود" : "زیان",
      });
    }
    if (position) {
      markers.push({
        time: (position.openedAt / 1000) as UTCTimestamp,
        position: "belowBar",
        color: UP,
        shape: "arrowUp",
        text: "ورود باز",
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    cs.setMarkers(markers);

    // خطوط Stop، هدف، ورود و سطوح کلیدی
    if (position) {
      cs.createPriceLine({ price: position.stop, color: DOWN, lineWidth: 2, lineStyle: LineStyle.Dashed, title: "Stop" });
      cs.createPriceLine({ price: position.target, color: UP, lineWidth: 2, lineStyle: LineStyle.Dashed, title: "هدف" });
      cs.createPriceLine({ price: position.entry, color: "#38BDF8", lineWidth: 1, lineStyle: LineStyle.Solid, title: "ورود" });
    }
    for (const l of levels.slice(0, 12)) {
      const isSupport = l.kind === "support" || l.kind === "order_block" || l.kind === "fvg";
      cs.createPriceLine({
        price: l.price,
        color: isSupport ? "rgba(16,185,129,0.4)" : "rgba(244,63,94,0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "",
      });
    }

    mainChart.current?.timeScale().fitContent();
  }, [candles, trades, position, levels, rsiPeriod]);

  return (
    <div dir="ltr" className="w-full">
      <div ref={mainRef} className="w-full overflow-hidden rounded-xl" />
      <div className="mt-1 flex items-center justify-between px-1">
        <span className="text-[11px] text-muted-foreground" dir="rtl">RSI({rsiPeriod})</span>
      </div>
      <div ref={rsiRef} className="w-full overflow-hidden rounded-xl" />
    </div>
  );
}
