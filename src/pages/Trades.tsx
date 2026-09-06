import { Activity, Gauge, Percent, Timer, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { useEngine, useEngineState } from "@/context/BotContext";
import { EXIT_REASON_LABELS } from "@/lib/engine/engine";
import { formatDateTime, formatDuration, formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Trades() {
  const engine = useEngine();
  const trades = useEngineState((e) => e.trades.slice());
  const stats = useEngineState((e) => e.stats());
  const rows = trades.slice().reverse();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-extrabold">معاملات بسته‌شده</h1>
        <p className="text-xs text-muted-foreground">
          تاریخچه کامل با دلیل ورود/خروج، سود و زیان، RR واقعی و متریک‌های عملکرد
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Win Rate" value={formatPct(stats.winRate, false)} icon={Percent} tone={stats.winRate >= 50 ? "profit" : "warn"} />
        <StatCard title="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2).replace(".", "٫") : "—"} icon={Gauge} tone={stats.profitFactor >= 1 ? "profit" : "loss"} />
        <StatCard title="Max Drawdown" value={formatPct(stats.maxDrawdownPct, false)} icon={TrendingDown} tone={stats.maxDrawdownPct > 8 ? "loss" : "neutral"} />
        <StatCard title="Expectancy" value={formatToman(stats.expectancy)} icon={stats.expectancy >= 0 ? TrendingUp : TrendingDown} tone={stats.expectancy >= 0 ? "profit" : "loss"} />
        <StatCard title="میانگین RR واقعی" value={stats.avgRR.toFixed(2).replace(".", "٫")} sub={`برنامه‌ریزی‌شده ≥ ${engine.cfg.minRR}`} icon={Activity} />
        <StatCard title="میانگین نگهداری" value={stats.tradeCount ? formatDuration(stats.avgHoldMs) : "—"} icon={Timer} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">
            تاریخچه معاملات ({rows.length.toLocaleString("fa-IR")})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length ? (
            <div className="scrollbar-thin max-h-[540px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">نماد</TableHead>
                    <TableHead className="text-xs">باز شدن</TableHead>
                    <TableHead className="text-xs">بسته شدن</TableHead>
                    <TableHead className="text-xs">ورود</TableHead>
                    <TableHead className="text-xs">خروج</TableHead>
                    <TableHead className="text-xs">سود/زیان</TableHead>
                    <TableHead className="text-xs">RR واقعی</TableHead>
                    <TableHead className="text-xs">دلیل خروج</TableHead>
                    <TableHead className="text-xs">مدت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TradeRow key={t.id + t.closedAt} t={t} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-12 text-center text-xs text-muted-foreground">
              هنوز معامله‌ای بسته نشده است — پس از اولین خروج، جزئیات کامل اینجا ثبت می‌شود.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TradeRow({ t }: { t: Trade }) {
  return (
    <TableRow className="text-xs">
      <TableCell className="font-bold">
        {symbolLabel(t.symbol)}
        {t.mode === "real" ? <Badge className="mr-1.5 rounded-full bg-loss/15 px-2 py-0.5 text-[9px] text-loss">واقعی</Badge> : null}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDateTime(t.openedAt)}</TableCell>
      <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDateTime(t.closedAt)}</TableCell>
      <TableCell className="num">{formatPrice(t.entry)}</TableCell>
      <TableCell className="num">{formatPrice(t.exit)}</TableCell>
      <TableCell>
        <span className={cn("num font-bold", t.pnl >= 0 ? "text-profit" : "text-loss")}>{formatToman(t.pnl)}</span>
        <span className={cn("num mr-1.5 text-[10px]", t.pnl >= 0 ? "text-profit" : "text-loss")}>{formatPct(t.pnlPct)}</span>
      </TableCell>
      <TableCell className={cn("num", t.rrActual >= 0 ? "text-profit" : "text-loss")}>
        {t.rrActual.toFixed(2).replace(".", "٫")}
      </TableCell>
      <TableCell>
        <p className="font-bold">{EXIT_REASON_LABELS[t.exitReason] ?? t.exitReason}</p>
        <p className="max-w-48 truncate text-[10px] text-muted-foreground">{t.entryReason}</p>
      </TableCell>
      <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDuration(t.holdMs)}</TableCell>
    </TableRow>
  );
}
