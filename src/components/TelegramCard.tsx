import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface TelegramView {
  configured: boolean;
  maskedToken: string | null;
  chatId: string;
  enabled: boolean;
  notifySignals: boolean;
  notifyPositions: boolean;
  notifyDigest: boolean;
}

/** کارت تنظیمات نوتیفیکیشن تلگرام — توکن فقط رمزنگاری‌شده سمت سرور ذخیره می‌شود */
export function TelegramCard() {
  const [view, setView] = useState<TelegramView | null>(null);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [notifySignals, setNotifySignals] = useState(true);
  const [notifyPositions, setNotifyPositions] = useState(true);
  const [notifyDigest, setNotifyDigest] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/telegram/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TelegramView>) : null))
      .then((data) => {
        if (!data) return;
        setView(data);
        setChatId(data.chatId);
        setEnabled(data.enabled);
        setNotifySignals(data.notifySignals);
        setNotifyPositions(data.notifyPositions);
        setNotifyDigest(data.notifyDigest);
      })
      .catch(() => undefined);
  }, []);

  const applyView = (data: TelegramView) => {
    setView(data);
    setChatId(data.chatId);
    setEnabled(data.enabled);
    setNotifySignals(data.notifySignals);
    setNotifyPositions(data.notifyPositions);
    setNotifyDigest(data.notifyDigest);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(token.trim() ? { botToken: token.trim() } : {}),
          chatId: chatId.trim(),
          enabled,
          notifySignals,
          notifyPositions,
          notifyDigest,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TelegramView & { ok?: boolean };
      applyView(data);
      setToken("");
      setMessage("تنظیمات تلگرام ذخیره شد.");
    } catch (err) {
      setMessage(`خطا در ذخیره: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setMessage(data.ok ? "پیام تست ارسال شد — تلگرام خود را بررسی کنید." : `ارسال ناموفق: ${data.error ?? `HTTP ${res.status}`}`);
    } catch (err) {
      setMessage(`خطا در ارسال تست: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <Send className="h-4 w-4 text-sky-400" /> نوتیفیکیشن تلگرام
        </CardTitle>
        <CardDescription className="text-[11px] leading-6">
          فرصت‌های جدید، باز/بسته‌شدن پوزیشن‌ها و گزارش دوره‌ای پوزیشن‌های باز (هر ۴ ساعت) به تلگرام شما ارسال می‌شود.
          توکن ربات فقط رمزنگاری‌شده (AES-256-GCM) سمت سرور ذخیره می‌شود.
          ساخت ربات: BotFather → /newbot و سپس chat_id خود را از BotFather یا @userinfobot بگیرید.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">
              توکن ربات{view?.maskedToken ? ` — ذخیره‌شده: ${view.maskedToken}` : " — ذخیره‌نشده"}
            </Label>
            <Input
              dir="ltr"
              type="password"
              autoComplete="off"
              placeholder="123456:ABC-DEF..."
              className="num h-8 rounded-lg text-[11px]"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">شناسه گفتگو (chat_id)</Label>
            <Input
              dir="ltr"
              autoComplete="off"
              placeholder="123456789"
              className="num h-8 rounded-lg text-[11px]"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            <span>فعال‌سازی نوتیفیکیشن‌ها</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            <span>سیگنال‌ها و فرصت‌ها</span>
            <Switch checked={notifySignals} onCheckedChange={setNotifySignals} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            <span>باز/بسته‌شدن پوزیشن‌ها</span>
            <Switch checked={notifyPositions} onCheckedChange={setNotifyPositions} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
            <span>گزارش دوره‌ای پوزیشن‌های باز</span>
            <Switch checked={notifyDigest} onCheckedChange={setNotifyDigest} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("rounded-full px-3 py-1", view?.configured && enabled ? "bg-profit/15 text-profit" : "bg-warn/15 text-warn")}>
            {view ? (view.configured ? (enabled ? "فعال و آماده ارسال" : "تنظیم‌شده ولی غیرفعال") : "تنظیم نشده") : "در حال بررسی…"}
          </Badge>
          <Button size="sm" className="rounded-full" disabled={saving} onClick={() => void save()}>
            ذخیره تنظیمات تلگرام
          </Button>
          <Button size="sm" variant="outline" className="rounded-full" disabled={testing || !view?.configured} onClick={() => void test()}>
            ارسال پیام تست
          </Button>
        </div>
        {message ? <p className={message.startsWith("خطا") || message.startsWith("ارسال ناموفق") ? "text-loss" : "text-profit"}>{message}</p> : null}
      </CardContent>
    </Card>
  );
}
