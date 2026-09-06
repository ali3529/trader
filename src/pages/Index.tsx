import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Gauge,
  Percent,
  PiggyBank,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HeaderBanner } from "@/components/brand/HeaderBanner";
import { StatCard } from "@/components/StatCard";
import { EquityChart } from "@/components/EquityChart";
import { CandleChart } from "@/components/CandleChart";
import { useEngine, useEngineState } from "@/context/BotContext";
import { fetchCandles } from "@/lib/engine/api";
import { allLevels } from "@/lib/strategy/levels";
import { lastAtr } from "@/lib/strategy/indicators";
import type { Candle } from "@/lib/types";
import { formatDuration, formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";

export default function Dashboard() {
  const engine = useEngine();
  const stats = useEngineState((e) => e.stats());
  const equity = useEngineState((e) => e.equity.slice());
  const positions = useEngineState((e) => e.positions.slice());
  const scans = useEngineState((e) => ({ ...e.scans }));
  const symbols = useEngineState((e) => e.symbols.slice());
  const trades = useEngineState((e) => e.trades.slice(-30));
  const account = useEngineState((e) => e.account ? {
    assetCount: Object.keys(e.account.totalBalances ?? e.account.balances).length,
    openOrderCount: e.account.openOrders.length,
    equityToman: e.nobitexEquityToman(),
  } : null);

  const [chartSymbol, setChartSymbol] = useState(symbols[0] ?? "BTCIRT");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (!symbols.includes(chartSymbol) && symbols.length) setChartSymbol(symbols[0]);
  }, [symbols, chartSymbol]);

  useEffect(() => {
    let alive = true;
    setChartLoading(true);
    const to = Date.now();
    fetchCandles(chartSymbol, "3600", to - 200 * 3_600_000, to)
      .then((c) => {
        if (alive) setCandles(c.filter((x) => x.time <= to - 3_600_000));
      })
      .catch(() => {
        if (alive) setCandles([]);
      })
      .finally(() => {
        if (alive) setChartLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chartSymbol, stats.lastTick]);

  const chartLevels = useMemo(() => {
    if (candles.length < 60) return [];
    const a = lastAtr(candles, 14);
    return a ? allLevels(candles, a).slice(0, 10) : [];
  }, [candles]);

  const position = positions.find((p) => p.symbol === chartSymbol) ?? null;
  const symbolTrades = trades.filter((t) => t.symbol === chartSymbol);
  const qualified = Object.values(scans).filter((s) => s.signal?.qualified);
  const pnlTone = stats.totalPnl >= 0 ? "profit" : "loss";
  const displayedCapital = account?.equityToman ?? engine.currentEquity();

  return (
    <div className="space-y-4">
      {/* بنر وضعیت کلی */}
      <Card className="relative overflow-hidden border-border/60">
        <HeaderBanner />
        <CardContent className="relative space-y-3 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{account ? "موجودی کل حساب نوبیتکس" : `سرمایه جاری (${stats.mode === "real" ? "واقعی" : "پولی"})`}</p>
              <p className="num text-2xl font-extrabold text-foreground md:text-3xl">{formatToman(displayedCapital)}</p>
              {account && stats.mode === "paper" ? (
                <p className="mt-1 text-[11px] text-muted-foreground">سرمایه Paper Trading: <span className="num">{formatToman(engine.currentEquity())}</span></p>
              ) : null}
            </div>
            <div className="text-left">
              <p className={stats.totalPnl >= 0 ? "num text-sm font-bold text-profit" : "num text-sm font-bold text-loss"}>
                {formatToman(stats.totalPnl)} ({formatPct(stats.totalPnlPct)})
              </p>
              <p className="text-[11px] text-muted-foreground">سود/زیان تحقق‌یافته کل</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="rounded-full border-border/70">آخرین بررسی: {stats.lastTick ? new Date(stats.lastTick).toLocaleTimeString("fa-IR") : "—"}</Badge>
            <Badge variant="outline" className="rounded-full border-border/70">سرمایه درگیر: {formatPct(stats.engagedCapitalPct, false)}</Badge>
            <Badge variant="outline" className="rounded-full border-border/70">Drawdown: {formatPct(stats.drawdownPct, false)}</Badge>
            {account ? <Badge variant="outline" className="rounded-full border-profit/40 text-profit">نوبیتکس: {account.assetCount.toLocaleString("fa-IR")} دارایی · {account.openOrderCount.toLocaleString("fa-IR")} سفارش باز</Badge> : null}
          </div>
        </CardContent>
      </Card>

      {/* آمار کلیدی */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="سود/زیان کل" value={formatToman(stats.totalPnl)} icon={stats.totalPnl >= 0 ? TrendingUp : TrendingDown} tone={pnlTone} />
        <StatCard title="Win Rate" value={formatPct(stats.winRate, false)} sub={`${stats.tradeCount} معامله بسته`} icon={Percent} />
        <StatCard title="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2).replace(".", "٫") : "—"} icon={Gauge} tone={stats.profitFactor >= 1 ? "profit" : "loss"} />
        <StatCard title="Max Drawdown" value={formatPct(stats.maxDrawdownPct, false)} icon={TrendingDown} tone={stats.maxDrawdownPct > 8 ? "loss" : "neutral"} />
        <StatCard title="پوزیشن‌های باز" value={stats.openPositions.toLocaleString("fa-IR")} sub={`از سقف ${engine.cfg.maxOpenPositions.toLocaleString("fa-IR")}`} icon={Wallet} />
        <StatCard title="میانگین نگهداری" value={stats.tradeCount ? formatDuration(stats.avgHoldMs) : "—"} icon={Activity} />
      </div>

      {/* منحنی سرمایه */}
      <Card className="border-border/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-bold">منحنی سرمایه</CardTitle>
          <Button size="sm" variant="ghost" className="rounded-full text-xs text-muted-foreground" onClick={() => void engine.tick()} disabled={engine.busy}>
            <RefreshCw className={engine.busy ? "ml-1 h-3.5 w-3.5 animate-spin" : "ml-1 h-3.5 w-3.5"} />
            بررسی اکنون
          </Button>
        </CardHeader>
        <CardContent>
          {equity.length > 1 ? (
            <EquityChart data={equity} />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              پس از اولین بررسی بازار، منحنی سرمایه اینجا رسم می‌شود
            </div>
          )}
        </CardContent>
      </Card>

      {/* چارت کندلی + پوزیشن‌ها */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-border/60 xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold">چارت کندلی ۱ ساعته با RSI</CardTitle>
            <Select value={chartSymbol} onValueChange={setChartSymbol}>
              <SelectTrigger className="h-8 w-40 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s} value={s}>{symbolLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {chartLoading && !candles.length ? (
              <div className="flex h-[460px] items-center justify-center text-xs text-muted-foreground">
                در حال دریافت داده از نوبیتکس… (به دلیل رعایت فاصله ۱۲ ثانیه‌ای ممکن است کمی طول بکشد)
              </div>
            ) : candles.length ? (
              <CandleChart
                candles={candles}
                trades={symbolTrades}
                position={position}
                levels={chartLevels}
                rsiPeriod={engine.cfg.rsiPeriod}
              />
            ) : (
              <div className="flex h-[460px] items-center justify-center text-xs text-muted-foreground">
                داده‌ای برای نمایش چارت دریافت نشد
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">پوزیشن‌های باز</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {positions.length ? (
                positions.map((p) => {
                  const price = scans[p.symbol]?.lastPrice ?? p.entry;
                  const upnl = (price - p.entry) * p.qty;
                  return (
                    <div key={p.id} className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{symbolLabel(p.symbol)}</span>
                        <span className={upnl >= 0 ? "num font-bold text-profit" : "num font-bold text-loss"}>
                          {formatToman(upnl)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>ورود: <span className="num text-foreground">{formatPrice(p.entry)}</span></span>
                        <span>Stop: <span className="num text-loss">{formatPrice(p.stop)}</span></span>
                        <span>هدف: <span className="num text-profit">{formatPrice(p.target)}</span></span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.breakEvenDone ? <Badge className="rounded-full bg-profit/15 px-2 py-0.5 text-[10px] text-profit">Break Even</Badge> : null}
                        {p.trailingActive ? <Badge className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-400">Trailing</Badge> : null}
                        {p.partialDone ? <Badge className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] text-warn">سیو سود جزئی</Badge> : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">پوزیشن بازی وجود ندارد</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <PiggyBank className="h-4 w-4 text-primary" />
                وضعیت ریسک
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-muted-foreground">ریسک هر معامله</span>
                <span className="num font-bold">{engine.cfg.riskPerTradePct.toLocaleString("fa-IR")}٪</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-muted-foreground">حداکثر سرمایه درگیر</span>
                <span className="num font-bold">{engine.cfg.maxEngagedCapitalPct.toLocaleString("fa-IR")}٪</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span className="text-muted-foreground">وضعیت Drawdown</span>
                <span className={cnTone(stats.riskState)}>
                  {stats.riskState === "normal" ? "عادی" : stats.riskState === "halved" ? "سایز نصف" : "توقف ورود"}
                </span>
              </div>
              <p className="pt-1 text-[11px] leading-5 text-muted-foreground">
                {qualified.length
                  ? `${qualified.length.toLocaleString("fa-IR")} فرصت واجد شرایط در اسکن اخیر یافت شد.`
                  : "در اسکن اخیر فرصت واجد شرایطی یافت نشد — ربات صبورانه پایش می‌کند."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function cnTone(state: string): string {
  if (state === "halved") return "num font-bold text-warn";
  if (state === "stopped") return "num font-bold text-loss";
  return "num font-bold text-profit";
}
