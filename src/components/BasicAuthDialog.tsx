import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_REQUIRED_EVENT, hasStoredCredentials, setBasicAuthCredentials } from "@/lib/basicAuth";

/** پنجرهٔ ورود درون‌برنامه‌ای برای routeهای حساس (جایگزین prompt مرورگر که برای fetch باز نمی‌شود) */
const BasicAuthDialog = () => {
  const [open, setOpen] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const onAuthRequired = () => {
      setWrong(hasStoredCredentials());
      setOpen(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedUser = user.trim();
    if (!trimmedUser || !password) return;
    setBasicAuthCredentials(trimmedUser, password);
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md rounded-2xl border-border/60 bg-card/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <KeyRound className="size-4" />
            </span>
            ورود به routeهای حساس
          </DialogTitle>
          <DialogDescription className="leading-6">
            سرور برای ذخیرهٔ کلیدها و دسترسی‌های حساس، اعتبارنامهٔ <span className="font-mono text-foreground">TRADEBAN_BASIC_AUTH</span> را
            می‌خواهد. پس از ورود، صفحه تازه‌سازی می‌شود و اعتبارنامه فقط تا بسته‌شدن همین تب معتبر است.
          </DialogDescription>
        </DialogHeader>
        {wrong && (
          <p className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive">
            اعتبارنامهٔ قبلی نادرست بود — کاربر و رمز را دوباره بررسی کنید.
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="basic-user">کاربر</Label>
            <Input
              id="basic-user"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              placeholder="tradeban"
              autoComplete="username"
              className="rounded-xl bg-background/60"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="basic-pass">رمز</Label>
            <Input
              id="basic-pass"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="rounded-xl bg-background/60"
            />
          </div>
          <Button type="submit" className="w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">
            ورود و تازه‌سازی
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BasicAuthDialog;
