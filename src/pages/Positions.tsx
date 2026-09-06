import { Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEngine, useEngineState } from "@/context/BotContext";
import { EXIT_REASON_LABELS } from "@/lib/engine/engine";
import { formatDuration, formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";

export default function Positions() {
  const engine = useEngine();
  const positions = useEngineState((e) => e.positions.slice());
  const scans = useEngineState((e) => ({ ...e.scans }));
  const mode = useEngineState((e) => e.mode);
  const exchangeOrders = useEngineState((e) => (e.account?.openOrders ?? []).slice()) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-extrabold">پوزیشن‌های باز</h1>
        <p className="text-xs text-muted-foreground">
          هر نماد وضعیت، Stop، Trailing و اهداف مستقل دارد — حداکثر {engine.cfg.maxOpenPositions.toLocaleString("fa-IR")} پوزیشن هم‌زمان
        </p>
      </div>

      {!positions.length ? (
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Wallet className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">پوزیشن بازی وجود ندارد.</p>
            <p className="max-w-md text-xs text-muted-foreground">
              ربات به‌طور خودکار پس از تأیید ساختار ۴ ساعته، الگوی ورود ۱ ساعته، فیلتر مومنتوم ۱۵ دقیقه و حداقل ۶ تأیید از ۸ معیار وارد معامله می‌شود.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {positions.map((p) => {
          const price = scans[p.symbol]?.lastPrice ?? p.entry;
          const upnl = (price - p.entry) * p.qty;
          const upnlPct = p.notional > 0 ? (upnl / p.notional) * 100 : 0;
          const riskPerUnit = p.entry - p.initialStop;
          const currentRR = riskPerUnit > 0 ? (price - p.entry) / riskPerUnit : 0;
          return (
            <Card key={p.id} className="border-border/60">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{symbolLabel(p.symbol)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      باز از {formatDuration(Date.now() - p.openedAt)} پیش · امتیاز سیگنال {p.signalScore.toLocaleString("fa-IR")}/۸ · {p.mode === "real" ? "واقعی" : "پولی"}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className={upnl >= 0 ? "num text-sm font-extrabold text-profit" : "num text-sm font-extrabold text-loss"}>
                      {formatToman(upnl)}
                    </p>
                    <p className={upnl >= 0 ? "num text-[11px] text-profit" : "num text-[11px] text-loss"}>{formatPct(upnlPct)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <Info label="قیمت ورود" value={formatPrice(p.entry)} />
                  <Info label="قیمت جاری" value={formatPrice(price)} />
                  <Info label="Stop فعلی" value={formatPrice(p.stop)} tone="loss" />
                  <Info label="هدف" value={formatPrice(p.target)} tone="profit" />
                  <Info label="مقدار" value={p.qty.toFixed(6).replace(/0+$/, "").replace(".", "٫")} />
                  <Info label="ارزش پوزیشن" value={formatToman(p.notional)} />
                  <Info label="RR جاری" value={currentRR.toFixed(2).replace(".", "٫")} tone={currentRR >= 0 ? "profit" : "loss"} />
                  <Info label="ATR ورود" value={formatPrice(p.atr)} />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {p.breakEvenDone ? <Badge className="rounded-full bg-profit/15 px-2.5 py-0.5 text-[10px] text-profit">Stop در نقطه ورود</Badge> : null}
                  {p.trailingActive ? (
                    <Badge className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[10px] text-sky-400">
                      Trailing با فاصله {engine.cfg.trailingAtrMult.toLocaleString("fa-IR")}×ATR
                    </Badge>
                  ) : null}
                  {p.partialDone ? <Badge className="rounded-full bg-warn/15 px-2.5 py-0.5 text-[10px] text-warn">{formatPct(engine.cfg.partialExitFraction * 100, false)} سیو شد</Badge> : null}
                </div>

                {p.legs.length ? (
                  <div className="rounded-lg border border-border/60 bg-secondary/30 p-2 text-[11px]">
                    <p className="mb-1 font-bold text-muted-foreground">پای‌های بسته‌شده:</p>
                    {p.legs.map((leg, i) => (
                      <p key={i} className="flex justify-between">
                        <span>{leg.reason || EXIT_REASON_LABELS.partial_take_profit}</span>
                        <span className={leg.pnl >= 0 ? "num text-profit" : "num text-loss"}>{formatToman(leg.pnl)}</span>
                      </p>
                    ))}
                  </div>
                ) : null}

                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full rounded-full text-xs"
                  onClick={() => engine.closePositionManually(p.id)}
                >
                  بستن دستی پوزیشن
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {mode === "real" ? (
        <Card className="border-loss/30">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="text-sm font-bold">سفارش‌های باز واقعی نوبیتکس</p>
              <p className="text-[11px] text-muted-foreground">
                این فهرست مستقیماً هنگام همگام‌سازی از صرافی می‌آید و از پوزیشن‌های داخلی جداست.
              </p>
            </div>
            {exchangeOrders.length ? (
              <div className="space-y-2">
                {exchangeOrders.map((order, index) => {
                  const id = Number(order.id ?? order.orderId);
                  const amount = Number(order.amount ?? order.unmatchedAmount ?? 0);
                  const priceToman = Number(order.price ?? order.averagePrice ?? 0) / 10;
                  return (
                    <div key={Number.isFinite(id) ? id : index} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="grid flex-1 grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                        <Info label="شناسه" value={Number.isFinite(id) ? id.toLocaleString("fa-IR") : "—"} />
                        <Info label="نوع" value={String(order.type ?? "—")} />
                        <Info label="مقدار" value={Number.isFinite(amount) ? amount.toLocaleString("fa-IR", { maximumFractionDigits: 8 }) : "—"} />
                        <Info label="قیمت (تومان)" value={priceToman > 0 ? formatPrice(priceToman) : "بازار"} />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full border-loss/40 text-xs text-loss"
                        disabled={!Number.isInteger(id) || id <= 0}
                        onClick={() => void engine.cancelExchangeOrder(id)}
                      >
                        لغو سفارش
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl bg-secondary/30 py-6 text-center text-xs text-muted-foreground">سفارش باز واقعی وجود ندارد.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={tone === "profit" ? "num text-xs font-bold text-profit" : tone === "loss" ? "num text-xs font-bold text-loss" : "num text-xs font-bold"}>
        {value}
      </p>
    </div>
  );
}
