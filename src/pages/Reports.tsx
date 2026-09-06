import { useMemo } from "react";
import { Activity, AlertOctagon, CalendarDays, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { useEngineState } from "@/context/BotContext";
import { formatPct, formatTime, formatToman, formatInt } from "@/lib/format";
import type { ApiLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Reports() {
  const logs = useEngineState((e) => e.apiLogs.slice());
  const daily = useEngineState((e) => e.dailyReports());

  const logStats = useMemo(() => {
    const ok = logs.filter((l) => l.status === "ok");
    const retries = logs.filter((l) => l.status === "retry");
    const errors = logs.filter((l) => l.status === "error");
    const avgLatency = ok.length ? ok.reduce((a, l) => a + l.latencyMs, 0) / ok.length : 0;
    const maxLatency = ok.length ? Math.max(...ok.map((l) => l.latencyMs)) : 0;
    return { total: logs.length, retries: retries.length, errors: errors.length, avgLatency, maxLatency };
  }, [logs]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-extrabold">گزارش‌ها و لاگ سیستم</h1>
        <p className="text-xs text-muted-foreground">گزارش روزانه معاملات + لاگ کامل خطاها، Retryها و تأخیرهای API</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard title="کل درخواست‌های API" value={formatInt(logStats.total)} icon={Activity} />
        <StatCard title="تلاش مجدد (Retry)" value={formatInt(logStats.retries)} icon={Repeat2} tone={logStats.retries ? "warn" : "neutral"} />
        <StatCard title="خطاها" value={formatInt(logStats.errors)} icon={AlertOctagon} tone={logStats.errors ? "loss" : "profit"} />
        <StatCard
          title="تأخیر میانگین / بیشینه"
          value={`${formatInt(logStats.avgLatency)} / ${formatInt(logStats.maxLatency)}`}
          sub="میلی‌ثانیه"
          icon={Activity}
        />
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarDays className="h-4 w-4 text-primary" />
            گزارش روزانه
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {daily.length ? (
            <div className="scrollbar-thin max-h-80 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">تاریخ</TableHead>
                    <TableHead className="text-xs">معاملات</TableHead>
                    <TableHead className="text-xs">برد / باخت</TableHead>
                    <TableHead className="text-xs">Win Rate</TableHead>
                    <TableHead className="text-xs">سود/زیان روز</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.map((d) => (
                    <TableRow key={d.date} className="text-xs">
                      <TableCell className="num font-bold">{d.date}</TableCell>
                      <TableCell className="num">{formatInt(d.trades)}</TableCell>
                      <TableCell className="num">
                        <span className="text-profit">{formatInt(d.wins)}</span> / <span className="text-loss">{formatInt(d.losses)}</span>
                      </TableCell>
                      <TableCell className="num">{formatPct(d.winRate, false)}</TableCell>
                      <TableCell className={cn("num font-bold", d.pnl >= 0 ? "text-profit" : "text-loss")}>{formatToman(d.pnl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">هنوز معامله‌ای بسته نشده تا گزارش روزانه ساخته شود.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">لاگ API (خطاها، Retryها و تأخیرها)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length ? (
            <div className="scrollbar-thin max-h-[420px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">زمان</TableHead>
                    <TableHead className="text-xs">Endpoint</TableHead>
                    <TableHead className="text-xs">وضعیت</TableHead>
                    <TableHead className="text-xs">تلاش</TableHead>
                    <TableHead className="text-xs">تأخیر</TableHead>
                    <TableHead className="text-xs">جزئیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.slice().reverse().map((l: ApiLogEntry, i) => (
                    <TableRow key={`${l.time}-${i}`} className="text-xs">
                      <TableCell className="num whitespace-nowrap text-muted-foreground">{formatTime(l.time)}</TableCell>
                      <TableCell className="num max-w-56 truncate text-[11px]" dir="ltr">{l.endpoint}</TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px]",
                            l.status === "ok" ? "bg-profit/15 text-profit" : l.status === "retry" ? "bg-warn/15 text-warn" : "bg-loss/15 text-loss"
                          )}
                        >
                          {l.status === "ok" ? "موفق" : l.status === "retry" ? "تلاش مجدد" : "خطا"}
                        </Badge>
                      </TableCell>
                      <TableCell className="num">{formatInt(l.attempt)}</TableCell>
                      <TableCell className="num">{formatInt(l.latencyMs)} ms</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">{l.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">هنوز درخواستی به API نوبیتکس ارسال نشده است.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
