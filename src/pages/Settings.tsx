import { useEffect, useState } from "react";
import { BrainCircuit, Cloud, Cpu, KeyRound, Landmark, ListChecks, RotateCcw, Save, ShieldAlert, Trash2 } from "lucide-react";
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
import { fetchAiConfig, fetchQwenStatus, saveAiConfig } from "@/lib/ai";
import type { AiConfigView, AiProvider, QwenStatus } from "@/lib/ai";
import { markUplinkDown, markUplinkUp, refreshExchangeProvider, setExchangeProvider } from "@/lib/engine/api";
import type { ExchangeProvider } from "@/lib/engine/api";

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
      { key: "minOrderToman", label: "حداقل ارزش سفارش (تومان)", step: 100000 },
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
    title: "Price Action پیشرفته",
    fields: [
      { key: "swingLookback", label: "کندل دو طرف Swing", step: 1 },
      { key: "levelClusterAtr", label: "تلورانس خوشه سطح (×ATR)", step: 0.05 },
      { key: "levelMinTouches", label: "حداقل برخورد S/R", step: 1 },
      { key: "orderBlockBodyPeriod", label: "دوره بدنه Order Block", step: 1 },
      { key: "orderBlockImpulseMult", label: "قدرت حرکت Order Block (×بدنه)", step: 0.1 },
      { key: "keyLevelLookbackBars", label: "عمق جست‌وجوی OB/FVG", step: 5 },
      { key: "maxKeyLevels", label: "حداکثر تعداد هر نوع سطح", step: 1 },
      { key: "fvgImpulseBodyRatio", label: "قدرت بدنه میانی FVG", step: 0.1 },
      { key: "stopBufferAtr", label: "حاشیه Stop زیر ساختار (×ATR)", step: 0.05 },
      { key: "exitChochBars", label: "پنجره CHoCH خروج (کندل)", step: 1 },
      { key: "pinbarLongWickRatio", label: "حداقل سایه بلند Pin Bar", step: 0.05 },
      { key: "pinbarOppositeWickRatio", label: "حداکثر سایه مخالف Pin Bar", step: 0.05 },
      { key: "pinbarMaxBodyRatio", label: "حداکثر بدنه Pin Bar", step: 0.05 },
      { key: "engulfingBodyRatio", label: "قدرت بدنه Engulfing", step: 0.1 },
      { key: "hammerWickBodyRatio", label: "سایه Hammer نسبت به بدنه", step: 0.25 },
      { key: "hammerOppositeWickBodyRatio", label: "سایه مخالف Hammer", step: 0.1 },
      { key: "hammerLocalLookback", label: "پنجره کف Hammer", step: 1 },
      { key: "hammerLowTolerancePct", label: "تلورانس کف Hammer (٪)", step: 0.1 },
      { key: "morningStarFirstBodyRatio", label: "بدنه اول Morning Star", step: 0.05 },
      { key: "morningStarMiddleBodyRatio", label: "بدنه میانی Morning Star", step: 0.05 },
      { key: "morningStarRecoveryRatio", label: "بازیابی Morning Star", step: 0.05 },
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
  needsUpgrade: boolean;
  realEnabled: boolean;
  sandbox: boolean;
  maskedKey: string | null;
}

interface ConnectionStatus {
  connected: boolean;
  privateEnabled: boolean;
  displayName: string | null;
  error: string | null;
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [realDialogOpen, setRealDialogOpen] = useState(false);
  const [provider, setProvider] = useState<ExchangeProvider>("nobitex");
  const [rzApiKey, setRzApiKey] = useState("");
  const [rzSecret, setRzSecret] = useState("");
  const [rzStatus, setRzStatus] = useState<{ configured: boolean; maskedKey: string | null; realEnabled: boolean } | null>(null);
  const [rzConfirmText, setRzConfirmText] = useState("");
  const [rzRealDialogOpen, setRzRealDialogOpen] = useState(false);
  const [rzMsg, setRzMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [qwenStatus, setQwenStatus] = useState<QwenStatus | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfigView | null>(null);
  const [aiDraft, setAiDraft] = useState({
    provider: "ollama" as AiProvider,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen3:4b",
    qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenModel: "qwen-plus",
    qwenToken: "",
  });
  const [aiSaving, setAiSaving] = useState(false);

  useEffect(() => setDraft({ ...cfg }), [cfg]);

  async function refreshKeyStatus() {
    try {
      const res = await fetch("/api/keys");
      const status = await res.json() as KeyStatus;
      setKeyStatus(status);
      if (!status.configured) setConnectionStatus(null);
      return status;
    } catch {
      setKeyStatus(null);
      return null;
    }
  }

  async function testConnection() {
    setConnectionStatus(null);
    try {
      const res = await fetch("/api/nobitex/ws-config", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { statusMessage?: string; message?: string } | null;
        throw new Error(body?.statusMessage ?? body?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { privateEnabled?: boolean; user?: { displayName?: string | null } };
      setConnectionStatus({
        connected: true,
        privateEnabled: data.privateEnabled === true,
        displayName: data.user?.displayName ?? null,
        error: null,
      });
    } catch (error) {
      setConnectionStatus({ connected: false, privateEnabled: false, displayName: null, error: (error as Error).message });
    }
  }
  useEffect(() => {
    void refreshKeyStatus().then((status) => {
      if (status?.configured) void testConnection();
    });
    void refreshAiConfig();
    void refreshExchangeProvider().then(setProvider);
    void refreshRzKeys();
  }, []);

  async function refreshRzKeys() {
    try {
      const res = await fetch("/api/ramzinex/keys");
      setRzStatus((await res.json()) as { configured: boolean; maskedKey: string | null; realEnabled: boolean });
    } catch {
      setRzStatus(null);
    }
  }

  async function chooseProvider(next: ExchangeProvider) {
    try {
      const res = await fetch("/api/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { statusMessage?: string } | null;
        setRzMsg({ ok: false, text: b?.statusMessage ?? `HTTP ${res.status}` });
        return;
      }
      setExchangeProvider(next);
      setProvider(next);
      setRzMsg({
        ok: true,
        text:
          next === "ramzinex"
            ? "صرافی فعال: رمزینکس — وب‌سوکت نوبیتکس خاموش می‌شود و اسکن روی کندل‌های بستهٔ REST ادامه دارد. صفحه تا لحظه‌ای دیگر بازنشانی می‌شود…"
            : "صرافی فعال: نوبیتکس — مسیر قبلی برقرار است. صفحه تا لحظه‌ای دیگر بازنشانی می‌شود…",
      });
      // بازنشانی صفحه تا وب‌سوکت و کش داده بازار با صرافی جدید راه‌اندازی شوند
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setRzMsg({ ok: false, text: (err as Error).message });
    }
  }

  async function saveRzKeys() {
    setRzMsg(null);
    try {
      const res = await fetch("/api/ramzinex/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: rzApiKey, secret: rzSecret }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { statusMessage?: string } | null;
        setRzMsg({ ok: false, text: `ذخیره ناموفق: ${b?.statusMessage ?? `HTTP ${res.status}`}` });
        return;
      }
      setRzApiKey("");
      setRzSecret("");
      setRzMsg({ ok: true, text: "کلیدهای رمزینکس رمزنگاری‌شده سمت سرور ذخیره شدند. (معامله واقعی همچنان غیرفعال است)" });
      await refreshRzKeys();
    } catch (err) {
      setRzMsg({ ok: false, text: `خطا: ${(err as Error).message}` });
    }
  }

  async function toggleRzReal(enable: boolean) {
    try {
      const res = await fetch("/api/ramzinex/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enable ? { enableReal: true, confirm: rzConfirmText } : { enableReal: false }),
      });
      const data = (await res.json()) as { ok?: boolean; statusMessage?: string; warning?: string | null };
      if (!res.ok) {
        if (res.status === 503) markUplinkDown(60_000, data.statusMessage ?? null);
        setRzMsg({ ok: false, text: data.statusMessage ?? "عملیات ناموفق بود" });
        return;
      }
      if (enable) {
        if (data.warning) markUplinkDown(60_000, data.warning);
        else markUplinkUp();
      }
      setRzMsg({
        ok: !data.warning,
        text: data.warning
          ? data.warning
          : enable
            ? "معامله واقعی رمزینکس فعال شد."
            : "معامله واقعی رمزینکس غیرفعال شد.",
      });
      setRzRealDialogOpen(false);
      setRzConfirmText("");
      await refreshRzKeys();
      if (!enable && mode === "real") await engine.setMode("paper");
    } catch (err) {
      setRzMsg({ ok: false, text: `خطا: ${(err as Error).message}` });
    }
  }

  async function refreshQwenStatus() {
    try {
      setQwenStatus(await fetchQwenStatus());
    } catch (error) {
      setQwenStatus({ reachable: false, ready: false, model: "qwen3:4b", installedModels: [], error: (error as Error).message });
    }
  }

  async function refreshAiConfig() {
    try {
      const config = await fetchAiConfig();
      setAiConfig(config);
      setAiDraft((d) => ({
        ...d,
        provider: config.provider,
        ollamaBaseUrl: config.ollamaBaseUrl,
        ollamaModel: config.ollamaModel,
        qwenBaseUrl: config.qwenBaseUrl,
        qwenModel: config.qwenModel,
      }));
    } catch {
      // وضعیت از طریق badge قابل مشاهده است
    }
  }

  async function saveAi() {
    setAiSaving(true);
    try {
      await saveAiConfig({ ...aiDraft, qwenToken: aiDraft.qwenToken.trim() });
      setSavedMsg("تنظیمات تحلیلگر AI ذخیره شد.");
      setTimeout(() => setSavedMsg(null), 4000);
      setAiDraft((d) => ({ ...d, qwenToken: "" }));
      await Promise.all([refreshAiConfig(), refreshQwenStatus()]);
    } catch (error) {
      setSavedMsg((error as Error).message);
      setTimeout(() => setSavedMsg(null), 6000);
    } finally {
      setAiSaving(false);
    }
  }

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
        const body = (await res.json().catch(() => null)) as { statusMessage?: string; message?: string } | null;
        setKeyMsg({ ok: false, text: `ذخیره ناموفق: ${body?.statusMessage ?? body?.message ?? `HTTP ${res.status}`}` });
        return;
      }
      setApiKey("");
      setApiSecret("");
      setKeyMsg({ ok: true, text: "کلیدها به‌صورت رمزنگاری‌شده سمت سرور ذخیره شدند. (معامله واقعی همچنان غیرفعال است)" });
      await refreshKeyStatus();
      await testConnection();
    } catch (err) {
      setKeyMsg({ ok: false, text: `خطا: ${(err as Error).message}` });
    }
  }

  async function deleteKeys() {
    await fetch("/api/keys", { method: "DELETE" });
    setKeyMsg({ ok: true, text: "کلیدها از سرور حذف شدند." });
    setConnectionStatus(null);
    await refreshKeyStatus();
  }

  async function toggleReal(enable: boolean) {
    try {
      const res = await fetch("/api/keys.real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enable ? { enable: true, confirm: confirmText } : { enable: false }),
      });
      const data = (await res.json()) as { ok?: boolean; statusMessage?: string; warning?: string | null };
      if (!res.ok) {
        if (res.status === 503) markUplinkDown(60_000, data.statusMessage ?? null);
        setKeyMsg({ ok: false, text: data.statusMessage ?? "عملیات ناموفق بود" });
        return;
      }
      if (enable) {
        if (data.warning) markUplinkDown(60_000, data.warning);
        else markUplinkUp();
      }
      setKeyMsg({
        ok: !data.warning,
        text: data.warning
          ? data.warning
          : enable
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
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-secondary/50 p-1">
          <TabsTrigger value="strategy" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <ListChecks className="ml-1 h-3.5 w-3.5" /> استراتژی و ریسک
          </TabsTrigger>
          <TabsTrigger value="keys" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <KeyRound className="ml-1 h-3.5 w-3.5" /> کلیدهای API و حالت معامله
          </TabsTrigger>
          <TabsTrigger value="symbols" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Landmark className="ml-1 h-3.5 w-3.5" /> نمادها
          </TabsTrigger>
          <TabsTrigger value="ai" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" onClick={() => { void refreshQwenStatus(); void refreshAiConfig(); }}>
            <BrainCircuit className="ml-1 h-3.5 w-3.5" /> تحلیلگر AI
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
              <CardTitle className="text-sm font-bold">صرافی فعال</CardTitle>
              <CardDescription className="text-[11px]">
                منبع دادهٔ بازار و معامله را انتخاب کنید: نوبیتکس یا رمزینکس. با انتخاب رمزینکس، وب‌سوکت نوبیتکس خاموش
                می‌شود و اسکن سیگنال روی کندل‌های بستهٔ REST ادامه دارد.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={provider === "nobitex" ? "default" : "outline"} className="rounded-full" onClick={() => void chooseProvider("nobitex")}>
                  نوبیتکس
                </Button>
                <Button size="sm" variant={provider === "ramzinex" ? "default" : "outline"} className="rounded-full" onClick={() => void chooseProvider("ramzinex")}>
                  رمزینکس
                </Button>
                {provider === "ramzinex" ? (
                  <Badge className="rounded-full bg-sky-500/15 px-3 py-1 text-sky-400">داده بازار و سفارش‌ها از رمزینکس</Badge>
                ) : null}
              </div>

              {provider === "ramzinex" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {rzStatus?.configured ? (
                      <>
                        <Badge className="rounded-full bg-profit/15 px-3 py-1 text-profit">کلید ذخیره شده: {rzStatus.maskedKey}</Badge>
                        {rzStatus.realEnabled ? (
                          <Badge className="rounded-full bg-loss/15 px-3 py-1 text-loss">معامله واقعی رمزینکس فعال</Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">معامله واقعی غیرفعال</Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">هیچ کلیدی ذخیره نشده — فقط داده عمومی بازار</Badge>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[11px]" htmlFor="rz-api-key">API-Key رمزینکس (x-api-key)</Label>
                      <Input id="rz-api-key" name="rz-api-key" autoComplete="off" dir="ltr" value={rzApiKey} onChange={(e) => setRzApiKey(e.target.value)} placeholder="کلید API از بخش مدیریت API رمزینکس" className="h-9 rounded-lg text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]" htmlFor="rz-secret">کلید محرمانه (Secret)</Label>
                      <Input id="rz-secret" name="rz-secret" autoComplete="new-password" dir="ltr" type="password" value={rzSecret} onChange={(e) => setRzSecret(e.target.value)} placeholder="secret نمایش‌داده‌شده هنگام ساخت کلید" className="h-9 rounded-lg text-xs" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Button size="sm" className="rounded-full" onClick={saveRzKeys} disabled={!rzApiKey || !rzSecret}>
                      <Save className="ml-1 h-3.5 w-3.5" /> ذخیره رمزنگاری‌شده
                    </Button>
                    {rzStatus?.configured ? (
                      rzStatus.realEnabled ? (
                        <Button size="sm" variant="outline" className="rounded-full border-loss/50 text-loss" onClick={() => void toggleRzReal(false)}>
                          غیرفعال‌سازی معامله واقعی رمزینکس
                        </Button>
                      ) : (
                        <AlertDialog open={rzRealDialogOpen} onOpenChange={setRzRealDialogOpen}>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" className="rounded-full">فعال‌سازی معامله واقعی رمزینکس…</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent dir="rtl" className="max-w-md rounded-2xl text-right">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-sm">تأیید روشن معامله واقعی رمزینکس</AlertDialogTitle>
                              <AlertDialogDescription className="text-xs leading-6">
                                با فعال‌سازی، ربات می‌تواند با پول واقعی شما در رمزینکس سفارش ارسال کند. برای تأیید، عبارت
                                زیر را دقیقاً وارد کنید:
                                <span className="num mt-2 block rounded-lg bg-secondary px-3 py-2 text-center font-bold text-loss" dir="ltr">
                                  ENABLE-REAL-TRADING
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <Input
                              dir="ltr"
                              value={rzConfirmText}
                              onChange={(e) => setRzConfirmText(e.target.value)}
                              placeholder="ENABLE-REAL-TRADING"
                              className="rounded-lg text-xs"
                            />
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-full text-xs">انصراف</AlertDialogCancel>
                              <AlertDialogAction className="rounded-full bg-loss text-white hover:bg-loss/90" onClick={() => void toggleRzReal(true)}>
                                می‌دانم و تأیید می‌کنم
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )
                    ) : null}
                  </div>
                </>
              ) : null}

              {rzMsg ? (
                <p className={cn("rounded-lg px-3 py-2 text-[11px]", rzMsg.ok ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss")}>
                  {rzMsg.text}
                </p>
              ) : null}
            </CardContent>
          </Card>

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
                    {keyStatus.realEnabled && connectionStatus?.connected ? (
                      <Badge className="rounded-full bg-loss/15 px-3 py-1 text-loss">معامله واقعی فعال</Badge>
                    ) : keyStatus.realEnabled ? (
                      <Badge className="rounded-full bg-warn/15 px-3 py-1 text-warn">معامله واقعی تا تأیید اتصال مسدود است</Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">معامله واقعی غیرفعال</Badge>
                    )}
                    {connectionStatus?.connected && connectionStatus.privateEnabled ? (
                      <Badge className="rounded-full bg-profit/15 px-3 py-1 text-profit">
                        REST + WebSocket خصوصی متصل{connectionStatus.displayName ? ` · ${connectionStatus.displayName}` : ""}
                      </Badge>
                    ) : connectionStatus?.error ? (
                      <Badge className="rounded-full bg-loss/15 px-3 py-1 text-loss" title={connectionStatus.error}>
                        احراز هویت ناموفق
                      </Badge>
                    ) : null}
                  </>
                ) : keyStatus?.needsUpgrade ? (
                  <Badge className="rounded-full bg-warn/15 px-3 py-1 text-warn">
                    کلید قدیمی و ناسازگار — کلید Ed25519 جدید ذخیره کنید
                  </Badge>
                ) : (
                  <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">هیچ کلیدی ذخیره نشده — فقط داده عمومی</Badge>
                )}
              </div>

              <Separator className="bg-border/60" />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px]" htmlFor="nobitex-public-key">Nobitex Public API Key</Label>
                  <Input id="nobitex-public-key" name="nobitex-public-key" autoComplete="off" dir="ltr" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="فیلد key از پاسخ ساخت API Key" className="h-9 rounded-lg text-xs" />
                  <p className="text-[10px] text-muted-foreground">ایمیل، User Token یا privateKey را اینجا وارد نکنید.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]" htmlFor="nobitex-private-key">Ed25519 Private Key</Label>
                  <Input id="nobitex-private-key" name="nobitex-private-key" autoComplete="new-password" dir="ltr" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="فیلد privateKey که فقط یک‌بار نمایش داده می‌شود" className="h-9 rounded-lg text-xs" />
                  <p className="text-[10px] text-muted-foreground">Private Key باید URL-safe Base64 و دقیقاً مربوط به همان public key باشد.</p>
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
                {keyStatus?.configured || keyStatus?.needsUpgrade ? (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => void testConnection()}>
                    <RotateCcw className="ml-1 h-3.5 w-3.5" /> تست REST و WebSocket
                  </Button>
                ) : null}
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

          <Card dir="rtl" className={cn("border-border/60", mode === "real" && "border-loss/50")}>
            <CardHeader className="items-start pb-2 text-right">
              <CardTitle className="flex w-full items-center justify-start gap-2 text-right text-sm font-bold">
                <ShieldAlert className={mode === "real" ? "h-4 w-4 text-loss" : "h-4 w-4 text-profit"} />
                حالت معامله
              </CardTitle>
              <CardDescription className="w-full text-right text-[11px] leading-6">
                حالت پیش‌فرض، معامله آزمایشی است. معامله واقعی با پول حقیقی فقط پس از تأیید روشن شما فعال می‌شود.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-right">
              <div className="flex w-full flex-col gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-right">
                  <p className="text-[10px] text-muted-foreground">حالت فعلی</p>
                  <p className={cn("mt-1 text-xs font-bold", mode === "real" ? "text-loss" : "text-profit")}>
                    {mode === "real" ? (
                      provider === "ramzinex" ? "معامله واقعی روی رمزینکس" : "معامله واقعی روی نوبیتکس"
                    ) : (
                      <>معامله آزمایشی <bdi dir="ltr" className="inline-block font-mono">(Paper Trading)</bdi></>
                    )}
                  </p>
                </div>
                <Switch
                  dir="ltr"
                  aria-label={mode === "real" ? "غیرفعال‌کردن معامله واقعی" : "تغییر به معامله واقعی"}
                  checked={mode === "real"}
                  onCheckedChange={(v) => void engine.setMode(v ? "real" : "paper")}
                />
              </div>

              {keyStatus?.configured ? (
                keyStatus.realEnabled ? (
                  <div className="flex justify-start">
                    <Button size="sm" variant="outline" className="rounded-full border-loss/50 text-loss" onClick={() => void toggleReal(false)}>
                      غیرفعال‌سازی اجازه معامله واقعی
                    </Button>
                  </div>
                ) : (
                  <AlertDialog open={realDialogOpen} onOpenChange={setRealDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" className="rounded-full">
                        فعال‌سازی معامله واقعی…
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir="rtl" className="max-w-md rounded-2xl text-right">
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
                <p className="text-[11px] text-muted-foreground">
                  {keyStatus?.needsUpgrade
                    ? "کلید ذخیره‌شده مربوط به API قدیمی است. از پنل نوبیتکس یک کلید جدید با READ و در صورت نیاز TRADE بسازید."
                    : "ابتدا کلیدهای API را ذخیره کنید."}
                </p>
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

        <TabsContent value="ai" className="mt-4 space-y-4">
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><BrainCircuit className="h-4 w-4 text-sky-400" /> تحلیلگر AI (محلی یا ابری)</CardTitle>
              <CardDescription className="text-[11px] leading-6">
                مدل فقط snapshot سیگنال را تحلیل می‌کند؛ کلید نوبیتکس، موجودی خصوصی و اختیار ارسال سفارش هرگز در اختیار مدل قرار نمی‌گیرد. توکن ابری فقط رمزنگاری‌شده (AES-256-GCM) در پوشهٔ .tradeban سمت سرور ذخیره می‌شود و به مرورگر برنمی‌گردد.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={aiDraft.provider === "ollama" ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => setAiDraft((d) => ({ ...d, provider: "ollama" }))}
                >
                  <Cpu className="ml-1 h-3.5 w-3.5" /> محلی (Ollama)
                </Button>
                <Button
                  size="sm"
                  variant={aiDraft.provider === "qwen-cloud" ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => setAiDraft((d) => ({ ...d, provider: "qwen-cloud" }))}
                >
                  <Cloud className="ml-1 h-3.5 w-3.5" /> ابر Qwen (با توکن)
                </Button>
              </div>

              {aiDraft.provider === "ollama" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">آدرس Ollama</Label>
                    <Input dir="ltr" className="num h-8 rounded-lg text-[11px]" value={aiDraft.ollamaBaseUrl} onChange={(e) => setAiDraft((d) => ({ ...d, ollamaBaseUrl: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">نام مدل محلی</Label>
                    <Input dir="ltr" className="num h-8 rounded-lg text-[11px]" value={aiDraft.ollamaModel} onChange={(e) => setAiDraft((d) => ({ ...d, ollamaModel: e.target.value }))} />
                  </div>
                  <div dir="ltr" className="num space-y-1 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left text-[11px] sm:col-span-2">
                    <p>ollama pull qwen3:4b</p>
                    <p>ollama serve</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">
                      توکن API
                      {aiConfig?.tokenMasked ? ` — ذخیره‌شده: ${aiConfig.tokenMasked}` : " — ذخیره‌نشده"}
                    </Label>
                    <Input
                      dir="ltr"
                      type="password"
                      autoComplete="off"
                      placeholder="sk-..."
                      className="num h-8 rounded-lg text-[11px]"
                      value={aiDraft.qwenToken}
                      onChange={(e) => setAiDraft((d) => ({ ...d, qwenToken: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">مدل ابری</Label>
                    <Input dir="ltr" className="num h-8 rounded-lg text-[11px]" value={aiDraft.qwenModel} onChange={(e) => setAiDraft((d) => ({ ...d, qwenModel: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">آدرس API (سازگار با OpenAI)</Label>
                    <Input dir="ltr" className="num h-8 rounded-lg text-[11px]" value={aiDraft.qwenBaseUrl} onChange={(e) => setAiDraft((d) => ({ ...d, qwenBaseUrl: e.target.value }))} />
                  </div>
                  <p className="text-muted-foreground sm:col-span-2">
                    پیش‌فرض، endpoint سازگار با OpenAIِ DashScope است (مدل‌ها: qwen-plus / qwen-turbo / qwen-max). هر endpoint سازگار با OpenAI که Qwen سرو می‌دهد قابل استفاده است.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("rounded-full px-3 py-1", qwenStatus?.ready ? "bg-profit/15 text-profit" : "bg-warn/15 text-warn")}>
                  {qwenStatus
                    ? qwenStatus.provider === "qwen-cloud"
                      ? qwenStatus.ready
                        ? `آماده: ${qwenStatus.model} (ابر Qwen)`
                        : qwenStatus.reachable
                          ? "ابر Qwen متصل؛ مدل یا توکن را بررسی کنید"
                          : "ابر Qwen در دسترس نیست"
                      : qwenStatus.ready
                        ? `آماده: ${qwenStatus.model}`
                        : qwenStatus.reachable
                          ? `Ollama متصل؛ مدل ${qwenStatus.model} نصب نیست`
                          : "Ollama در دسترس نیست"
                    : "وضعیت بررسی نشده"}
                </Badge>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => void refreshQwenStatus()}>بررسی دوباره</Button>
                <Button size="sm" className="rounded-full" disabled={aiSaving} onClick={() => void saveAi()}>
                  <Save className="ml-1 h-4 w-4" /> ذخیره تنظیمات AI
                </Button>
              </div>
              {qwenStatus?.error ? <p className="text-loss">{qwenStatus.error}</p> : null}
              <p className="text-muted-foreground">در صفحه «فرصت‌ها» دکمه «بررسی مشورتی Qwen» از همان ارائه‌دهندهٔ انتخاب‌شده اینجا استفاده می‌کند. تصمیم قطعی همچنان فقط با موتور Price Action و ریسک انجام می‌شود.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
