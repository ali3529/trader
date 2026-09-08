import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  FileBarChart2,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  Play,
  ScanSearch,
  Settings,
  Square,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/brand/Logo";
import { useEngine, useEngineState } from "@/context/BotContext";
import { useDataSource, useExchangeProvider } from "@/hooks/useDataSource";
import { useUplink } from "@/hooks/useUplink";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";

const NAV = [
  { to: "/", label: "داشبورد", icon: LayoutDashboard },
  { to: "/opportunities", label: "فرصت‌های واجد شرایط", icon: ScanSearch },
  { to: "/positions", label: "پوزیشن‌ها", icon: Wallet },
  { to: "/trades", label: "معاملات بسته‌شده", icon: History },
  { to: "/backtest", label: "بک‌تست", icon: FlaskConical },
  { to: "/reports", label: "گزارش‌ها", icon: FileBarChart2 },
  { to: "/settings", label: "تنظیمات", icon: Settings },
];

/** نشان قطع اتصال حساب (موجودی/سفارش‌ها) با شمارش معکوس تا تلاش مجدد */
function UplinkBadge() {
  const uplink = useUplink();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (uplink.status !== "down") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [uplink.status]);
  if (uplink.status !== "down") return null;
  const secs = Math.max(0, Math.ceil((uplink.downUntil - Date.now()) / 1000));
  return (
    <Badge
      className="rounded-full bg-loss/15 px-3 py-1 text-xs text-loss"
      title={uplink.message ?? undefined}
    >
      <Wallet className="ml-1 h-3.5 w-3.5" />
      {secs > 0
        ? `اتصال حساب قطع است — تلاش مجدد تا ${secs.toLocaleString("fa-IR")} ثانیه`
        : "اتصال حساب قطع است — در حال تلاش مجدد…"}
    </Badge>
  );
}

function StatusStrip() {
  const engine = useEngine();
  const stats = useEngineState((e) => e.stats());
  const ws = useEngineState((e) => ({ ...e.websocket }));
  const dataSource = useDataSource();
  const provider = useExchangeProvider();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className={cn(
          "rounded-full border-border/70 px-3 py-1 text-xs",
          stats.mode === "real" ? "border-loss/60 text-loss" : "border-profit/50 text-profit"
        )}
      >
        {stats.mode === "real" ? "معامله واقعی" : "Paper Trading"}
      </Badge>
      <Badge className="rounded-full bg-sky-500/15 px-3 py-1 text-xs text-sky-400">
        صرافی: {provider === "ramzinex" ? "رمزینکس" : "نوبیتکس"}
      </Badge>
      {dataSource === "demo" ? (
        <Badge
          className="rounded-full bg-warn/15 px-3 py-1 text-xs text-warn"
          title="اتصال سرور به صرافی فعال برقرار نشد؛ دادهٔ نمایش‌داده‌شده شبیه‌سازی‌شده است."
        >
          داده شبیه‌سازی‌شده — صرافی در دسترس نیست
        </Badge>
      ) : null}
      <UplinkBadge />
      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-xs text-muted-foreground">
        <span className={cn("ml-1.5 inline-block h-2 w-2 rounded-full", stats.running ? "animate-pulse bg-profit" : "bg-muted-foreground/50")} />
        {stats.running ? "در حال پایش بازار" : "متوقف"}
      </Badge>
      <Badge
        variant="outline"
        className={cn(
          "rounded-full px-3 py-1 text-xs",
          ws.status === "connected" ? "border-profit/50 text-profit" : ws.status === "error" ? "border-loss/60 text-loss" : "border-warn/50 text-warn"
        )}
        title={ws.error ?? (ws.lastMessageAt ? `آخرین پیام: ${new Date(ws.lastMessageAt).toLocaleTimeString("fa-IR")}` : undefined)}
      >
        {ws.status === "connected" ? <Wifi className="ml-1 h-3.5 w-3.5" /> : <WifiOff className="ml-1 h-3.5 w-3.5" />}
        {ws.status === "connected"
          ? ws.privateEnabled ? "WebSocket خصوصی" : "WebSocket عمومی"
          : ws.status === "connecting" ? "اتصال WebSocket…"
            : ws.status === "reconnecting" ? "اتصال مجدد WebSocket…"
              : ws.status === "error" ? "خطای WebSocket" : "WebSocket خاموش"}
      </Badge>
      {stats.nextTick ? (
        <span className="hidden text-xs text-muted-foreground md:inline">
          بررسی بعدی: <span className="num">{formatTime(stats.nextTick)}</span>
        </span>
      ) : null}
      {stats.riskState !== "normal" ? (
        <Badge className="rounded-full bg-warn/15 px-3 py-1 text-xs text-warn">
          {stats.riskState === "halved" ? "سایز معاملات نصف شد" : "ورود جدید متوقف (Drawdown)"}
        </Badge>
      ) : null}
      <Button
        size="sm"
        variant={stats.running ? "destructive" : "default"}
        className="rounded-full"
        onClick={() => (stats.running ? engine.stop() : engine.start())}
      >
        {stats.running ? <Square className="ml-1 h-3.5 w-3.5" /> : <Play className="ml-1 h-3.5 w-3.5" />}
        {stats.running ? "توقف ربات" : "شروع ربات"}
      </Button>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-primary/15 font-bold text-primary"
                : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const engine = useEngine();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // شروع خودکار پایش در حالت Paper (پیش‌فرض امن) —
  // اگر رانر ۲۴/۷ سمت سرور در حال اجراست، موتور محلی خودکار روشن نمی‌شود
  // تا دو موتور موازی روی یک حساب کاغذی کار نکنند.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void (async () => {
      let serverRunning = false;
      try {
        const res = await fetch("/api/bot/status", { cache: "no-store" });
        if (res.ok) serverRunning = ((await res.json()) as { running?: boolean }).running === true;
      } catch {
        serverRunning = false;
      }
      if (!cancelled && !serverRunning && !engine.running && engine.mode === "paper") engine.start();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const notice = useEngineState((e) => e.notice);

  return (
    <div className="flex min-h-screen bg-background">
      {/* سایدبار دسکتاپ — در RTL سمت راست قرار می‌گیرد */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar-background p-4 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <Logo size={38} />
          <div>
            <p className="text-base font-extrabold text-foreground">تریدبان</p>
            <p className="text-[11px] text-muted-foreground">ربات معامله‌گر نوبیتکس</p>
          </div>
        </div>
        <NavLinks />
        <div className="mt-auto rounded-xl border border-border/60 bg-secondary/40 p-3 text-[11px] leading-5 text-muted-foreground">
          <p className="font-bold text-warn">⚠️ سلب مسئولیت</p>
          هیچ سودی تضمین نمی‌شود. معاملات ارز دیجیتال پرریسک است؛ ابتدا با Paper Trading و بک‌تست بسنجید.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* هدر موبایل */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Logo size={30} />
            <span className="text-sm font-extrabold">تریدبان</span>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="rounded-xl">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-sidebar-background p-4">
              <div className="mb-6 flex items-center gap-3">
                <Logo size={34} />
                <span className="font-extrabold">تریدبان</span>
              </div>
              <NavLinks />
            </SheetContent>
          </Sheet>
        </header>

        {/* نوار وضعیت */}
        <div className="border-b border-border/60 bg-card/40 px-4 py-2.5">
          <StatusStrip />
        </div>

        {notice ? (
          <div className="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs text-foreground">
            {notice}
            <button className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => { engine.notice = null; }}>✕</button>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppShell;
