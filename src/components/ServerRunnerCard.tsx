import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CloudCog, Copy, Play, RotateCcw, Square } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEngineState } from "@/context/BotContext";
import { cn } from "@/lib/utils";

interface RunnerPosition {
  symbol: string;
  qty: number;
  entry: number;
  price: number;
  stop: number;
  target: number;
  pnlPct: number;
  mode: "paper" | "real";
}

interface RunnerScan {
  symbol: string;
  score: number;
  qualified: boolean;
  price: number;
  note: string;
  updatedAt: number;
}

interface RunnerStatus {
  running: boolean;
  mode: "paper" | "real";
  realReady: boolean;
  cash: number;
  equity: number;
  peakEquity: number;
  initialCapital: number;
  positions: RunnerPosition[];
  tradesCount: number;
  wins: number;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  lastError: string | null;
  lastNotes: string[];
  scans: RunnerScan[];
}

const faNum = (v: number, digits = 0) => v.toLocaleString("fa-IR", { maximumFractionDigits: digits });
const faPrice = (v: number) => faNum(v, v < 100 ? 4 : 0);

function relativeFa(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return `${faNum(Math.round(-diff / 60_000))} دقیقه دیگر`;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${faNum(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faNum(hours)} ساعت پیش`;
  return `${faNum(Math.floor(hours / 24))} روز پیش`;
}

/**
 * کنترل و پایش رانر ۲۴/۷ سمت سرور — حتی وقتی مرورگر/سیستم خاموش است،
 * Vercel Cron (یا پینگر خارجی) هر ۱۰ دقیقه یک tick اجرا می‌کند.
 */
export function ServerRunnerCard() {
  const selectedMode = useEngineState((e) => e.mode);
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as RunnerStatus);
    } catch {
      // سرور در دسترس نیست — وضعیت قبلی نگه داشته می‌شود
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh, selectedMode]);

  async function control(body: { running?: boolean; reset?: boolean; mode?: "paper" | "real" }, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as (RunnerStatus & { statusMessage?: string; message?: string }) | null;
      if (!res.ok) {
        setMsg({ ok: false, text: data?.statusMessage ?? data?.message ?? `HTTP ${res.status}` });
        return;
      }
      if (data) setStatus(data);
      setMsg({ ok: true, text: okText });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      setStartOpen(false);
      setResetOpen(false);
    }
  }

  const pingUrl = `${window.location.origin}/api/cron/tick`;
  const mode = status?.running ? status.mode : selectedMode;
  const isReal = mode === "real";

  return (
    <Card dir="rtl" className={cn("border-border/60", isReal && "border-loss/50")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <CloudCog className={cn("h-4 w-4", status?.running ? "text-profit" : "text-sky-400")} />
          رانر ۲۴/۷ سرور ({isReal ? "Real" : "Paper"})
          {status ? (
            <Badge
              className={cn(
                "mr-auto rounded-full px-3 py-0.5 text-[10px]",
                status.running ? "bg-profit/15 text-profit" : "bg-secondary text-muted-foreground"
              )}
            >
              {status.running ? "در حال اجرا روی سرور" : "خاموش"}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription className="text-[11px] leading-6">
          این صفحه فقط داشبورد است. رانر روی سرور هر ۱۰ دقیقه بازار را بررسی می‌کند و پس از بستن تب هم ادامه
          می‌دهد. در حالت Real سفارش‌ها فقط با کلید فعال و تأیید ENABLE-REAL-TRADING روی صرافی ثبت می‌شوند.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                <p className="text-[10px] text-muted-foreground">ارزش حساب</p>
                <p className="num mt-1 font-bold">{faNum(status.equity)} <span className="text-[9px] text-muted-foreground">تومان</span></p>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                <p className="text-[10px] text-muted-foreground">نقد / سقف</p>
                <p className="num mt-1 font-bold">{faNum(status.cash)} / {faNum(status.peakEquity)}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                <p className="text-[10px] text-muted-foreground">معاملات (برد)</p>
                <p className="num mt-1 font-bold">{faNum(status.tradesCount)} ({faNum(status.wins)})</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5">
                <p className="text-[10px] text-muted-foreground">آخرین tick</p>
                <p className="num mt-1 font-bold">{relativeFa(status.lastTickAt)}</p>
                <p className="num text-[9px] text-muted-foreground">بعدی: {relativeFa(status.nextTickAt)}</p>
              </div>
            </div>

            {status.running && status.tickCount === 0 ? (
              <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[11px] leading-5 text-warn">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                رانر روشن است اما هنوز هیچ tick سروری اجرا نشده؛ تا زمانی که شمارنده tick افزایش پیدا نکند،
                هیچ سیگنال یا پوزیشنی بررسی نمی‌شود. در اجرای محلی سرور را با نسخه جدید restart کنید؛ در
                serverless نیز Cron را بررسی کنید.
              </p>
            ) : null}

            {status.positions.length ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground">پوزیشن‌های باز سرور</p>
                {status.positions.map((p) => (
                  <div key={p.symbol} className="num flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px]">
                    <b>{p.symbol}</b>
                    <Badge className={cn("rounded-full px-2 py-0.5 text-[9px]", p.mode === "real" ? "bg-loss/15 text-loss" : "bg-profit/15 text-profit")}>{p.mode === "real" ? "واقعی" : "Paper"}</Badge>
                    <span>{faNum(p.qty, 6)} @ {faPrice(p.entry)}</span>
                    <span>فعلی {faPrice(p.price)}</span>
                    <span className={p.pnlPct >= 0 ? "text-profit" : "text-loss"}>
                      {p.pnlPct >= 0 ? "+" : ""}{faNum(p.pnlPct, 2)}٪
                    </span>
                    <span className="text-muted-foreground">SL {faPrice(p.stop)} · TP {faPrice(p.target)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {status.scans.length ? (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground">آخرین ارزیابی نمادها</p>
                <div className="flex flex-wrap gap-1.5">
                  {status.scans.map((s) => (
                    <Badge
                      key={s.symbol}
                      variant="outline"
                      className={cn(
                        "num rounded-full border-border/70 px-3 py-1 text-[10px]",
                        s.qualified ? "border-profit/50 text-profit" : s.score > 0 ? "text-foreground" : "text-muted-foreground"
                      )}
                      title={s.note}
                    >
                      {s.symbol} · {faNum(s.score)}/۸
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {status.lastError ? (
              <p className="rounded-lg bg-loss/10 px-3 py-2 text-[11px] text-loss">خطای آخرین tick: {status.lastError}</p>
            ) : null}
            {status.lastNotes.length ? (
              <details className="rounded-lg bg-secondary/40 px-3 py-2 text-[10px] text-muted-foreground">
                <summary className="cursor-pointer">یادداشت‌های آخرین tick ({faNum(status.lastNotes.length)})</summary>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {status.lastNotes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">در حال دریافت وضعیت از سرور…</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {status?.running ? (
            <Button size="sm" variant="outline" className="rounded-full border-loss/50 text-loss" disabled={busy} onClick={() => void control({ running: false }, "رانر سرور خاموش شد.")}>
              <Square className="ml-1 h-3.5 w-3.5" /> خاموش‌کردن رانر
            </Button>
          ) : (
            isReal ? (
              <AlertDialog open={startOpen} onOpenChange={setStartOpen}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" className="rounded-full" disabled={busy || !status || !status.realReady}>
                    <Play className="ml-1 h-3.5 w-3.5" /> روشن‌کردن رانر واقعی ۲۴/۷…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl" className="max-w-md rounded-2xl text-right">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-sm">اجرای معامله واقعی روی سرور؟</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs leading-6">
                      رانر بعد از بستن مرورگر هم فعال می‌ماند و می‌تواند سفارش واقعی خرید و فروش ثبت کند. گیت
                      ENABLE-REAL-TRADING و محدودیت‌های ریسک سمت سرور همچنان اعمال می‌شوند.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-full text-xs">انصراف</AlertDialogCancel>
                    <AlertDialogAction className="rounded-full bg-loss text-white hover:bg-loss/90" onClick={() => void control({ running: true, mode: "real" }, "رانر واقعی سرور روشن شد و پس از بستن مرورگر ادامه می‌دهد.")}>
                      روشن‌کردن رانر واقعی
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button size="sm" className="rounded-full" disabled={busy || !status} onClick={() => void control({ running: true, mode: "paper" }, "رانر Paper سرور روشن شد و پس از بستن مرورگر ادامه می‌دهد.")}>
                <Play className="ml-1 h-3.5 w-3.5" /> روشن‌کردن رانر Paper ۲۴/۷
              </Button>
            )
          )}
          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="rounded-full" disabled={busy || isReal} title={isReal ? "دفتر Real برای جلوگیری از قطع همگام‌سازی قابل بازنشانی نیست" : undefined}>
                <RotateCcw className="ml-1 h-3.5 w-3.5" /> بازنشانی حساب رانر
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl" className="max-w-md rounded-2xl text-right">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-sm">بازنشانی رانر سرور؟</AlertDialogTitle>
                <AlertDialogDescription className="text-xs leading-6">
                  تمام پوزیشن‌ها، معاملات و منحنی سرمایهٔ Paper رانر ۲۴/۷ پاک می‌شود و حساب با سرمایه اولیهٔ
                  کاغذی از صفر شروع می‌کند. دفتر Real و سفارش‌های صرافی دست‌نخورده می‌مانند.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-full text-xs">انصراف</AlertDialogCancel>
                <AlertDialogAction className="rounded-full bg-loss text-white hover:bg-loss/90" onClick={() => void control({ reset: true }, "حساب رانر بازنشانی شد.")}>
                  بازنشانی
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" variant="ghost" className="rounded-full text-xs" onClick={() => void refresh()}>
            <RotateCcw className="ml-1 h-3.5 w-3.5" /> به‌روزرسانی
          </Button>
        </div>

        {msg ? (
          <p className={cn("rounded-lg px-3 py-2 text-[11px]", msg.ok ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
            {msg.text}
          </p>
        ) : null}

        <div className="space-y-1.5 rounded-xl border border-border/60 bg-secondary/20 p-3 text-[10px] leading-5 text-muted-foreground">
          <p className="font-bold text-foreground">فعال‌سازی روی Vercel (یک‌بار):</p>
          <ol className="list-decimal space-y-1 pr-4">
            <li>
              در پنل Vercel → Environment Variables متغیر <bdi dir="ltr" className="font-mono">CRON_SECRET</bdi> را با
              یک رمز دلخواه قوی بسازید و Redeploy بزنید. Cron روزانهٔ Vercel به‌عنوان fallback
              <bdi dir="ltr" className="font-mono"> /api/cron/tick </bdi> را صدا می‌زند.
            </li>
            <li>
              برای چرخهٔ واقعی ۱۰ دقیقه‌ای روی Hobby، یک پینگر مثل <bdi dir="ltr">cron-job.org</bdi> بسازید:
              every 10 minutes، متد GET، همین آدرس با هدر
              <bdi dir="ltr" className="font-mono"> Authorization: Bearer &lt;CRON_SECRET&gt;</bdi>:
            </li>
          </ol>
          <div className="flex items-center gap-2">
            <Input dir="ltr" readOnly value={pingUrl} className="num h-7 flex-1 rounded-lg bg-background text-[10px]" onFocus={(e) => e.target.select()} />
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 rounded-lg"
              onClick={() => { void navigator.clipboard.writeText(pingUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-profit" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
