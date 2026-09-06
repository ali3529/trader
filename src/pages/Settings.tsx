import { useEffect, useState } from "react";
import { KeyRound, Landmark, ListChecks, RotateCcw, Save, ShieldAlert, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useEngine, useEngineState } from "@/context/BotContext";
import { DEFAULT_CONFIG } from "@/lib/config";
import type { StrategyConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

interface FieldDef {
  key: keyof StrategyConfig;
  label: string;
  hint?: string;
  step?: number;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "ریسک و سرمایه",
    fields: [
      { key: "riskPerTradePct", label: "ریسک هر معامله (٪)", step: 0.1, hint: "حداکثر پیشنهادی ۱٪" },
      { key: "maxOpenPositions", label: "حداکثر پوزیشن هم‌زمان", step: 1 },
      { key: "maxEngagedCapitalPct", label: "حداکثر سرمایه درگیر (٪)", step: 1 },
      { key: "drawdownHalvePct", label: "Drawdown نصف‌کردن سایز (٪)", step: 1 },
      { key: "drawdownStopPct", label: "Drawdown توقف ورود (٪)", step: 1 },
      { key: "paperInitialCapital", label: "سرمایه اولیه پولی (تومان)", step: 1000000 },
    ],
  },
  {
    title: "شروط ورود و امتیازدهی",
    fields: [
      { key: "minConfirmations", label: "حداقل تأیید از ۸ معیار", step: 1 },
      { key: "minRR", label: "حداقل نسبت ریسک/ریوارد", step: 0.1 },
      { key: "rsiPeriod", label: "دوره RSI", step: 1 },
      { key: "atrPeriod", label: "دوره ATR", step: 1 },
      { key: "rsiMin", label: "کف RSI سالم یک‌ساعته", step: 1 },
      { key: "rsiMax", label: "سقف RSI سالم یک‌ساعته", step: 1 },
      { key: "momentumRsiMin", label: "حداقل RSI مومنتوم ۱۵ دقیقه", step: 1 },
      { key: "momentumRsiMax", label: "سقف RSI مومنتوم ۱۵ دقیقه", step: 1 },
      { key: "volumeAvgPeriod", label: "دوره میانگین حجم", step: 1 },
      { key: "minVolumeRatio", label: "حداقل نسبت حجم سیگنال", step: 0.1 },
      { key: "stopAtrMin", label: "حداقل فاصله Stop (×ATR)", step: 0.1 },
      { key: "stopAtrMax", label: "حداکثر فاصله Stop (×ATR)", step: 0.1 },
      { key: "levelProximityAtr", label: "تلورانس نزدیکی به سطح (×ATR)", step: 0.1 },
    ],
  },
  {
    title: "مدیریت معامله",
    fields: [
      { key: "breakEvenRR", label: "RR انتقال Stop به ورود", step: 0.1 },
      { key: "trailingAtrMult", label: "فاصله Trailing (×ATR)", step: 0.1 },
      { key: "partialExitRR", label: "RR خروج جزئی", step: 0.1 },
      { key: "partialExitFraction", label: "کسر خروج جزئی (۰.۵ = ۵۰٪)", step: 0.05 },
      { key: "feePct", label: "کارمزد صرافی (٪)", step: 0.01 },
      { key: "slippagePct", label: "لغزش قیمت (٪)", step: 0.01 },
    ],
  },
  {
    title: "Grid (فقط تقسیم سرمایه — نه سیگنال)",
    fields: [
      { key: "gridLevels", label: "تعداد سطوح Grid", step: 1 },
      { key: "gridZones", label: "تعداد ناحیه تقسیم سرمایه", step: 1 },
      { key: "gridMinRangePct", label: "حداقل فاصله S/R برای فعال‌شدن (٪)", step: 0.5 },
      { key: "gridLookbackDays", label: "پنجره محاسبه S/R اصلی (روز)", step: 1 },
    ],
  },
  {
    title: "API و زمان‌بندی",
    fields: [
      { key: "tickIntervalMs", label: "دوره بررسی بازار (میلی‌ثانیه)", step: 60000 },
      { key: "apiMinIntervalMs", label: "حداقل فاصله درخواست‌ها (میلی‌ثانیه)", step: 1000 },
      { key: "apiMaxRetries", label: "حداکثر تلاش مجدد", step: 1 },
      { key: "apiRetryDelayMs", label: "مکث تلاش مجدد (میلی‌ثانیه)", step: 1000 },
    ],
  },
];

interface KeyStatus {
  configured: boolean;
  realEnabled: boolean;
  sandbox: boolean;
  maskedKey: string | null;
}

export default function SettingsPage() {
  const engine = useEngine();
  const cfg = useEngineState((e) => e.cfg);
  const symbols = useEngineState((e) => e.symbols.slice());
  const mode = useEngineState((e) => e.mode);

  const [draft, setDraft] = useState<Record<string, number>>(() => ({ ...cfg }));
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [symbolText, setSymbolText] = useState(symbols.join("\n"));
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [realDialogOpen, setRealDialogOpen] = useState(false);

  useEffect(() => setDraft({ ...cfg }), [cfg]);

  async function refreshKeyStatus() {
    try {
      const res = await fetch("/api/keys");
      setKeyStatus(await res.json());
    } catch {
      setKeyStatus(null);
    }
  }
  useEffect(() => {
    void refreshKeyStatus();
  }, []);

  function saveStrategy() {
    const next = { ...cfg } as StrategyConfig;
    for (const group of GROUPS) {
      for (const f of group.fields) {
        const v = Number(draft[f.key]);
        if (isFinite(v)) (next[f.key] as number) = v;
      }
    }
    engine.setConfig(next);
    setSavedMsg("تنظیمات استراتژی ذخیره و اعمال شد.");
    setTimeout(() => setSavedMsg(null), 4000);
  }

  function saveSymbols() {
    const list = symbolText
      .split(/[\s,،]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const valid = list.filter((s) => /^[A-Z]{2,12}IRT$/.test(s));
    if (!valid.length) {
      setSavedMsg("هیچ نماد معتبری وارد نشد (نمونه معتبر: BTCIRT).");
      return;
    }
    engine.setSymbols(Array.from(new Set(valid)));
    setSymbolText(valid.join("\n"));
    setSavedMsg(`${valid.length.toLocaleString("fa-IR")} نماد ذخیره شد.`);
    setTimeout(() => setSavedMsg(null), 4000);
  }

  async function saveKeys() {
    setKeyMsg(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, sandbox, enableReal: false }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setKeyMsg({ ok: false, text: `ذخیره ناموفق: ${text.slice(0, 150)}` });
        return;
      }
      setApiKey("");
      setApiSecret("");
      setKeyMsg({ ok: true, text: "کلیدها به‌صورت رمزنگاری‌شده سمت سرور ذخیره شدند. (معامله واقعی همچنان غیرفعال است)" });
      await refreshKeyStatus();
    } catch (err) {
      setKeyMsg({ ok: false, text: `خطا: ${(err as Error).message}` });
    }
  }

  async function deleteKeys() {
    await fetch("/api/keys", { method: "DELETE" });
    setKeyMsg({ ok: true, text: "کلیدها از سرور حذف شدند." });
    await refreshKeyStatus();
  }

  async function toggleReal(enable: boolean) {
    try {
      const res = await fetch("/api/keys.real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enable ? { enable: true, confirm: confirmText } : { enable: false }),
      });
      const data = (await res.json()) as { ok?: boolean; statusMessage?: string };
      if (!res.ok) {
        setKeyMsg({ ok: false, text: data.statusMessage ?? "عملیات ناموفق بود" });
        return;
      }
      setKeyMsg({
        ok: true,
        text: enable
          ? "معامله واقعی فعال شد. اکنون می‌توانید حالت ربات را روی «واقعی» بگذارید."
          : "معامله واقعی غیرفعال شد.",
      });
      setRealDialogOpen(false);
      setConfirmText("");
      await refreshKeyStatus();
      if (!enable && mode === "real") await engine.setMode("paper");
    } catch (err) {
      setKeyMsg({ ok: false, text: `خطا: ${(err as Error).message}` });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-extrabold">تنظیمات</h1>
        <p className="text-xs text-muted-foreground">
          تمام آستانه‌های استراتژی قابل تنظیم‌اند · کلیدهای API فقط سمت سرور و رمزنگاری‌شده نگهداری می‌شوند
        </p>
      </div>

      {savedMsg ? (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs">{savedMsg}</p>
      ) : null}

      <Tabs defaultValue="strategy" className="w-full">
        <TabsList className="w-full justify-start rounded-xl bg-secondary/50 p-1">
          <TabsTrigger value="strategy" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ListChecks className="ml-1 h-3.5 w-3.5" /> استراتژی و ریسک
          </TabsTrigger>
          <TabsTrigger value="keys" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <KeyRound className="ml-1 h-3.5 w-3.5" /> کلیدهای API و حالت معامله
          </TabsTrigger>
          <TabsTrigger value="symbols" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Landmark className="ml-1 h-3.5 w-3.5" /> نمادها
          </TabsTrigger>
        </TabsList>

        {/* ---------- استراتژی ---------- */}
        <TabsContent value="strategy" className="mt-4 space-y-4">
          {GROUPS.map((group) => (
            <Card key={group.title} className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold">{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {group.fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`cfg-${f.key}`}>
                      {f.label}
                    </Label>
                    <Input
                      id={`cfg-${f.key}`}
                      type="number"
                      step={f.step ?? 1}
                      value={draft[f.key] ?? cfg[f.key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
                      className="num h-8 rounded-lg text-xs"
                    />
                    {f.hint ? <p className="text-[10px] text-muted-foreground/70">{f.hint}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveStrategy} className="rounded-full">
              <Save className="ml-1 h-4 w-4" /> ذخیره تنظیمات
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setDraft({ ...DEFAULT_CONFIG });
                engine.setConfig({ ...DEFAULT_CONFIG });
                setSavedMsg("تنظیمات به پیش‌فرض بازگشت.");
              }}
            >
              <RotateCcw className="ml-1 h-4 w-4" /> بازگشت به پیش‌فرض
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => {
                engine.resetPaper();
                setSavedMsg("حساب Paper Trading بازنشانی شد.");
              }}
            >
              بازنشانی حساب پولی
            </Button>
          </div>
        </TabsContent>

        {/* ---------- کلیدها ---------- */}
        <TabsContent value="keys" className="mt-4 space-y-4">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">وضعیت اتصال به نوبیتکس</CardTitle>
              <CardDescription className="text-[11px]">
                کلیدها با AES-256-GCM روی سرور رمزنگاری می‌شوند و هرگز به مرورگر یا لاگ‌ها برنمی‌گردند.
                کلید خود را در چت یا کد فرانت‌اند به اشتراک نگذارید؛ اگر جایی لو رفته، همان لحظه در نوبیتکس باطلش کنید.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {keyStatus?.configured ? (
                  <>
                    <Badge className="rounded-full bg-profit/15 px-3 py-1 text-profit">کلید ذخیره شده: {keyStatus.maskedKey}</Badge>
                    {keyStatus.sandbox ? <Badge className="rounded-full bg-sky-500/15 px-3 py-1 text-sky-400">محیط Sandbox</Badge> : null}
                    {keyStatus.realEnabled ? (
                      <Badge className="rounded-full bg-loss/15 px-3 py-1 text-loss">معامله واقعی فعال</Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">معامله واقعی غیرفعال</Badge>
                    )}
                  </>
                ) : (
                  <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">هیچ کلیدی ذخیره نشده — فقط داده عمومی</Badge>
                )}
              </div>

              <Separator className="bg-border/60" />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px]" htmlFor="api-key">API Key</Label>
                  <Input id="api-key" dir="ltr" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="کلید API نوبیتکس" className="h-9 rounded-lg text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]" htmlFor="api-secret">API Secret</Label>
                  <Input id="api-secret" dir="ltr" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Secret Key" className="h-9 rounded-lg text-xs" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={sandbox} onCheckedChange={setSandbox} />
                  استفاده از محیط Sandbox نوبیتکس
                </label>
                <Button size="sm" className="rounded-full" onClick={saveKeys} disabled={!apiKey || !apiSecret}>
                  <Save className="ml-1 h-3.5 w-3.5" /> ذخیره رمزنگاری‌شده
                </Button>
                {keyStatus?.configured ? (
                  <Button size="sm" variant="destructive" className="rounded-full" onClick={deleteKeys}>
                    <Trash2 className="ml-1 h-3.5 w-3.5" /> حذف کلیدها
                  </Button>
                ) : null}
              </div>

              {keyMsg ? (
                <p className={cn("rounded-lg px-3 py-2 text-[11px]", keyMsg.ok ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
                  {keyMsg.text}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className={cn("border-border/60", mode === "real" && "border-loss/50")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <ShieldAlert className={mode === "real" ? "h-4 w-4 text-loss" : "h-4 w-4 text-profit"} />
                حالت معامله
              </CardTitle>
              <CardDescription className="text-[11px]">
                حالت پیش‌فرض Paper Trading است. معامله واقعی با پول حقیقی فقط پس از تأیید روشن شما فعال می‌شود.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={mode === "real"}
                    onCheckedChange={(v) => void engine.setMode(v ? "real" : "paper")}
                  />
                  <span className={mode === "real" ? "font-bold text-loss" : "font-bold text-profit"}>
                    {mode === "real" ? "معامله واقعی روی نوبیتکس" : "Paper Trading (شبیه‌سازی)"}
                  </span>
                </label>
              </div>

              {keyStatus?.configured ? (
                keyStatus.realEnabled ? (
                  <Button size="sm" variant="outline" className="rounded-full border-loss/50 text-loss" onClick={() => void toggleReal(false)}>
                    غیرفعال‌سازی معامله واقعی
                  </Button>
                ) : (
                  <AlertDialog open={realDialogOpen} onOpenChange={setRealDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" className="rounded-full">
                        فعال‌سازی معامله واقعی…
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-w-md rounded-2xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-sm">تأیید روشن معامله واقعی</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs leading-6">
                          با فعال‌سازی، ربات می‌تواند با پول واقعی شما در نوبیتکس سفارش خرید ارسال کند. هیچ سودی تضمین نمی‌شود
                          و مسئولیت کامل معاملات بر عهده شماست. برای تأیید، عبارت زیر را دقیقاً وارد کنید:
                          <span className="num mt-2 block rounded-lg bg-secondary px-3 py-2 text-center font-bold text-loss" dir="ltr">
                            ENABLE-REAL-TRADING
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Input
                        dir="ltr"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="ENABLE-REAL-TRADING"
                        className="rounded-lg text-xs"
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-full text-xs">انصراف</AlertDialogCancel>
                        <AlertDialogAction
                          className="rounded-full bg-loss text-white hover:bg-loss/90"
                          onClick={() => void toggleReal(true)}
                        >
                          می‌دانم و تأیید می‌کنم
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )
              ) : (
                <p className="text-[11px] text-muted-foreground">ابتدا کلیدهای API را ذخیره کنید.</p>
              )}

              {mode === "real" ? (
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => void engine.syncWithExchange()}>
                  همگام‌سازی سفارش‌ها و موجودی با صرافی
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- نمادها ---------- */}
        <TabsContent value="symbols" className="mt-4 space-y-4">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">نمادهای تحت پایش</CardTitle>
              <CardDescription className="text-[11px]">
                هر نماد در یک خط، با قالب نوبیتکس (مثل BTCIRT یا ETHIRT). بازارهای پرنقدشونده‌تر در اسکن رتبه بالاتر می‌گیرند.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                dir="ltr"
                value={symbolText}
                onChange={(e) => setSymbolText(e.target.value)}
                rows={8}
                className="num rounded-xl text-xs"
              />
              <Button onClick={saveSymbols} className="rounded-full">
                <Save className="ml-1 h-4 w-4" /> ذخیره نمادها
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
