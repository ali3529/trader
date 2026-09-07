import { useState } from "react";
import { AlertTriangle, FlaskConical, Play } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { EquityChart } from "@/components/EquityChart";
import { useEngine, useEngineState } from "@/context/BotContext";
import { fetchCandles, getExchangeProvider } from "@/lib/engine/api";
import { runBacktest } from "@/lib/backtest/backtest";
import { EXIT_REASON_LABELS } from "@/lib/engine/engine";
import type { BacktestResult, Candle } from "@/lib/types";
import { formatDateTime, formatDuration, formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Gauge, Percent, TrendingDown, TrendingUp } from "lucide-react";

const RES_15M = "900";
const BAR_MS = 900_000;
const MAX_PER_REQUEST = 999;

export default function Backtest() {
  const engine = useEngine();
  const symbols = useEngineState((e) => e.symbols.slice());
  const [symbol, setSymbol] = useState(symbols[0] ?? "BTCIRT");
  const [days, setDays] = useState(15);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setStatus(`در حال دریافت کندل‌های ۱۵ دقیقه از ${getExchangeProvider() === "ramzinex" ? "رمزینکس" : "نوبیتکس"}…`);
    try {
      const to = Date.now();
      const start = to - days * 86_400_000;
      const all: Candle[] = [];
      let cursor = start;
      while (cursor < to) {
        const chunkEnd = Math.min(cursor + MAX_PER_REQUEST * BAR_MS, to);
        setStatus(`دریافت داده تا ${formatDateTime(chunkEnd)} — به دلیل فاصله اجباری ۱۲ ثانیه‌ای بین درخواست‌ها کمی صبر کنید…`);
        const part = await fetchCandles(symbol, RES_15M, cursor, chunkEnd);
        all.push(...part);
        cursor = chunkEnd;
        setProgress(Math.min(95, ((cursor - start) / (to - start)) * 100));
      }
      const closed = all.filter((c) => c.time <= to - BAR_MS).sort((a, b) => a.time - b.time);
      if (closed.length < 1000) {
        setError(`داده کافی دریافت نشد (${closed.length.toLocaleString("fa-IR")} کندل) — نماد یا بازه را تغییر دهید.`);
        return;
      }
      setStatus(`اجرای شبیه‌سازی روی ${closed.length.toLocaleString("fa-IR")} کندل بسته‌شده…`);
      // اجرای شبیه‌سازی در رویداد بعدی تا UI به‌روز شود
      await new Promise((r) => setTimeout(r, 50));
      const res = runBacktest({ symbol, candles15m: closed, cfg: engine.cfg });
      setResult(res);
      setProgress(100);
      setStatus(null);
    } catch (err) {
      setError(`بک‌تست ناموفق بود: ${(err as Error).message}`);
      setStatus(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-extrabold">بک‌تست استراتژی</h1>
        <p className="text-xs text-muted-foreground">
          شبیه‌سازی رویدادی بدون Look-ahead Bias با کارمزد، لغزش قیمت، خروج جزئی، Break Even و Trailing Stop
        </p>
      </div>

      <Alert className="border-warn/30 bg-warn/10 text-warn">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-xs font-bold">نتیجه گذشته، آینده را تضمین نمی‌کند</AlertTitle>
        <AlertDescription className="text-[11px] leading-5">
          این ابزار هیچ سودی را تضمین نمی‌کند. پیش از فعال‌سازی معامله واقعی، استراتژی را با بک‌تست و Paper Trading بسنجید.
        </AlertDescription>
      </Alert>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">نماد</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-9 w-44 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s} value={s}>{symbolLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="bt-days">تعداد روز</Label>
            <Input
              id="bt-days"
              type="number"
              min={5}
              max={60}
              value={days}
              onChange={(e) => setDays(Math.max(5, Math.min(60, Number(e.target.value) || 5)))}
              className="num h-9 w-24 rounded-lg text-xs"
            />
          </div>
          <Button onClick={handleRun} disabled={running} className="rounded-full">
            {running ? <FlaskConical className="ml-1 h-4 w-4 animate-pulse" /> : <Play className="ml-1 h-4 w-4" />}
            اجرای بک‌تست
          </Button>
          <p className="text-[11px] text-muted-foreground">
            سرمایه اولیه: {formatToman(engine.cfg.paperInitialCapital)} · کارمزد {engine.cfg.feePct}٪ · لغزش {engine.cfg.slippagePct}٪
          </p>
        </CardContent>
        {running || status ? (
          <CardContent className="space-y-2 pt-0">
            <Progress value={progress} className="h-2" />
            {status ? <p className="text-[11px] text-muted-foreground">{status}</p> : null}
          </CardContent>
        ) : null}
        {error ? (
          <CardContent className="pt-0">
            <p className="rounded-lg bg-loss/10 px-3 py-2 text-xs text-loss">{error}</p>
          </CardContent>
        ) : null}
      </Card>

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard title="سود/زیان کل" value={formatToman(result.metrics.totalPnl)} sub={formatPct(result.metrics.totalPnlPct)} icon={result.metrics.totalPnl >= 0 ? TrendingUp : TrendingDown} tone={result.metrics.totalPnl >= 0 ? "profit" : "loss"} />
            <StatCard title="Win Rate" value={formatPct(result.metrics.winRate, false)} sub={`${result.metrics.tradeCount.toLocaleString("fa-IR")} معامله`} icon={Percent} />
            <StatCard title="Profit Factor" value={isFinite(result.metrics.profitFactor) ? result.metrics.profitFactor.toFixed(2).replace(".", "٫") : "—"} icon={Gauge} tone={result.metrics.profitFactor >= 1 ? "profit" : "loss"} />
            <StatCard title="Max Drawdown" value={formatPct(result.metrics.maxDrawdownPct, false)} icon={TrendingDown} tone={result.metrics.maxDrawdownPct > 8 ? "loss" : "neutral"} />
            <StatCard title="Expectancy" value={formatToman(result.metrics.expectancy)} sub="میانگین سود هر معامله" icon={TrendingUp} tone={result.metrics.expectancy >= 0 ? "profit" : "loss"} />
            <StatCard title="میانگین نگهداری" value={result.metrics.tradeCount ? formatDuration(result.metrics.avgHoldMs) : "—"} icon={FlaskConical} />
          </div>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">نمودار سرمایه بک‌تست</CardTitle>
            </CardHeader>
            <CardContent>
              {result.equity.length > 1 ? (
                <EquityChart data={result.equity} height={260} />
              ) : (
                <p className="py-8 text-center text-xs text-muted-foreground">در این بازه معامله‌ای ثبت نشد تا منحنی سرمایه شکل بگیرد.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">لیست معاملات ({result.trades.length.toLocaleString("fa-IR")})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {result.trades.length ? (
                <div className="scrollbar-thin max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs">ورود</TableHead>
                        <TableHead className="text-xs">خروج</TableHead>
                        <TableHead className="text-xs">قیمت ورود</TableHead>
                        <TableHead className="text-xs">قیمت خروج</TableHead>
                        <TableHead className="text-xs">سود/زیان</TableHead>
                        <TableHead className="text-xs">RR واقعی</TableHead>
                        <TableHead className="text-xs">دلیل خروج</TableHead>
                        <TableHead className="text-xs">کارمزد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.trades.map((t) => (
                        <TableRow key={t.id} className="text-xs">
                          <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDateTime(t.openedAt)}</TableCell>
                          <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDateTime(t.closedAt)}</TableCell>
                          <TableCell className="num">{formatPrice(t.entry)}</TableCell>
                          <TableCell className="num">{formatPrice(t.exit)}</TableCell>
                          <TableCell className={cn("num font-bold", t.pnl >= 0 ? "text-profit" : "text-loss")}>{formatToman(t.pnl)}</TableCell>
                          <TableCell className={cn("num", t.rrActual >= 0 ? "text-profit" : "text-loss")}>{t.rrActual.toFixed(2).replace(".", "٫")}</TableCell>
                          <TableCell className="font-bold">{EXIT_REASON_LABELS[t.exitReason] ?? t.exitReason}</TableCell>
                          <TableCell className="num text-muted-foreground">{formatToman(t.fees)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  در این بازه هیچ سیگنالی همه شروط حیاتی و حداقل {engine.cfg.minConfirmations.toLocaleString("fa-IR")} تأیید از ۸ را پاس نکرد — یعنی استراتژی وارد معامله نشد.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
