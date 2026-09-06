import { useState } from "react";
import { BrainCircuit, Check, ChevronDown, Loader2, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyOpportunities } from "@/components/brand/EmptyOpportunities";
import { useEngine, useEngineState } from "@/context/BotContext";
import { formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";
import { PATTERN_LABELS } from "@/lib/strategy/patterns";
import { cn } from "@/lib/utils";
import type { SymbolScan } from "@/lib/types";
import { analyzeOpportunity } from "@/lib/ai";
import type { QwenAnalysis } from "@/lib/ai";

const STATUS_META: Record<SymbolScan["status"], { label: string; cls: string }> = {
  qualified: { label: "واجد شرایط", cls: "bg-profit/15 text-profit" },
  watching: { label: "در حال پایش", cls: "bg-secondary text-muted-foreground" },
  blocked: { label: "مسدود", cls: "bg-warn/15 text-warn" },
  error: { label: "خطا", cls: "bg-loss/15 text-loss" },
};

export default function Opportunities() {
  const engine = useEngine();
  const scans = useEngineState((e) => Object.values(e.scans));
  const [open, setOpen] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, QwenAnalysis>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});

  async function runQwen(scan: SymbolScan) {
    setAiLoading(scan.symbol);
    setAiErrors((current) => ({ ...current, [scan.symbol]: "" }));
    try {
      const result = await analyzeOpportunity(scan);
      setAiResults((current) => ({ ...current, [scan.symbol]: result }));
    } catch (error) {
      setAiErrors((current) => ({ ...current, [scan.symbol]: (error as Error).message }));
    } finally {
      setAiLoading(null);
    }
  }

  const sorted = scans.slice().sort((a, b) => {
    const qa = a.signal?.qualified ? 1 : 0;
    const qb = b.signal?.qualified ? 1 : 0;
    if (qa !== qb) return qb - qa;
    return (b.signal?.score ?? 0) - (a.signal?.score ?? 0) || a.liquidityRank - b.liquidityRank;
  });
  const qualifiedCount = sorted.filter((s) => s.signal?.qualified).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold">فرصت‌های واجد شرایط</h1>
          <p className="text-xs text-muted-foreground">
            نتیجه اسکن {sorted.length.toLocaleString("fa-IR")} نماد — سیگنال فقط از Price Action روی کندل بسته‌شده؛ Grid هرگز سیگنال ورود نیست
          </p>
        </div>
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => void engine.tick()} disabled={engine.busy}>
          <RefreshCw className={engine.busy ? "ml-1 h-3.5 w-3.5 animate-spin" : "ml-1 h-3.5 w-3.5"} />
          اسکن مجدد
        </Button>
      </div>

      {!scans.length ? (
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <EmptyOpportunities />
            <p className="text-sm text-muted-foreground">
              ربات هنوز بازاری را اسکن نکرده است — با زدن «شروع ربات» یا «اسکن مجدد» منتظر بمانید تا کندل ۱۵ دقیقه‌ای بسته شود.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {scans.length && !qualifiedCount ? (
        <Card className="border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <EmptyOpportunities size={140} />
            <p className="text-xs text-muted-foreground">در حال حاضر هیچ نمادی همه شروط حیاتی و حداقل ۶ تأیید از ۸ را ندارد — پایش ادامه دارد.</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {sorted.map((scan) => {
          const signal = scan.signal;
          const meta = STATUS_META[scan.status];
          const expanded = open === scan.symbol;
          return (
            <Card key={scan.symbol} className={cn("border-border/60", signal?.qualified && "border-profit/40")}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-bold">{symbolLabel(scan.symbol)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        رتبه نقدشوندگی: <span className="num">{scan.liquidityRank ? scan.liquidityRank.toLocaleString("fa-IR") : "—"}</span>
                        {" · "}حجم ۲۴ ساعت: <span className="num">{scan.volume24h ? formatToman(scan.volume24h) : "—"}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num text-sm font-bold">{scan.lastPrice ? formatPrice(scan.lastPrice) : "—"}</span>
                    <span className={cn("num text-xs font-bold", scan.changePct24h >= 0 ? "text-profit" : "text-loss")}>
                      {formatPct(scan.changePct24h)}
                    </span>
                    <Badge className={cn("rounded-full px-2.5 py-0.5 text-[11px]", meta.cls)}>{meta.label}</Badge>
                  </div>
                </div>

                {signal ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className={cn("rounded-full border-border/70 px-3 py-1", signal.qualified ? "text-profit" : "text-muted-foreground")}>
                        امتیاز ورود: <span className="num mr-1">{signal.score.toLocaleString("fa-IR")} از ۸</span>
                      </Badge>
                      {signal.pattern ? (
                        <Badge variant="outline" className="rounded-full border-primary/40 px-3 py-1 text-primary">
                          {PATTERN_LABELS[signal.pattern]}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground">
                        RR: <span className="num text-foreground">{signal.rr.toFixed(2).replace(".", "٫")}</span>
                      </span>
                      <span className="text-muted-foreground">
                        ورود: <span className="num text-foreground">{formatPrice(signal.entry)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Stop: <span className="num text-loss">{formatPrice(signal.stop)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        هدف: <span className="num text-profit">{formatPrice(signal.target)}</span>
                      </span>
                      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1 text-muted-foreground">
                        Grid: {signal.grid?.enabled ? `فعال (${signal.grid.levels.length.toLocaleString("fa-IR")} سطح)` : "غیرفعال"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full border-sky-500/30 px-3 text-[11px] text-sky-400"
                        disabled={aiLoading === scan.symbol}
                        onClick={() => void runQwen(scan)}
                      >
                        {aiLoading === scan.symbol ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="ml-1 h-3.5 w-3.5" />}
                        بررسی مشورتی Qwen
                      </Button>
                    </div>

                    {aiResults[scan.symbol] ? (
                      <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-sky-400">تحلیل مشورتی Qwen</p>
                          <Badge variant="outline" className="rounded-full border-sky-500/30 text-sky-400">
                            اطمینان {aiResults[scan.symbol].confidence.toLocaleString("fa-IR", { maximumFractionDigits: 0 })}٪
                          </Badge>
                        </div>
                        <p className="mt-2 leading-6 text-foreground">{aiResults[scan.symbol].summary}</p>
                        {aiResults[scan.symbol].risks.length ? (
                          <p className="mt-2 text-warn">ریسک‌ها: {aiResults[scan.symbol].risks.join(" · ")}</p>
                        ) : null}
                        <p className="mt-2 text-muted-foreground">این خروجی سیگنال یا مجوز معامله نیست و هیچ سفارشی ارسال نمی‌کند.</p>
                      </div>
                    ) : aiErrors[scan.symbol] ? (
                      <p className="mt-3 rounded-lg bg-loss/10 px-3 py-2 text-[11px] text-loss">Qwen در دسترس نیست: {aiErrors[scan.symbol]}</p>
                    ) : null}

                    <button
                      className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setOpen(expanded ? null : scan.symbol)}
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                      جزئیات ۸ معیار امتیازدهی
                    </button>

                    {expanded ? (
                      <div className="mt-2 grid gap-1.5 md:grid-cols-2">
                        {signal.criteria.map((c) => (
                          <div
                            key={c.id}
                            className={cn(
                              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]",
                              c.passed ? "border-profit/25 bg-profit/5" : "border-loss/20 bg-loss/5"
                            )}
                          >
                            {c.passed ? (
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-profit" />
                            ) : (
                              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" />
                            )}
                            <div>
                              <p className="font-bold text-foreground">
                                {c.label}
                                {c.critical ? <span className="mr-1.5 text-[10px] text-warn">حیاتی</span> : null}
                              </p>
                              <p className="text-muted-foreground">{c.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">{scan.note}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
