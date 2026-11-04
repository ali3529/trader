import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyOpportunities } from "@/components/brand/EmptyOpportunities";
import { useEngine, useEngineState } from "@/context/BotContext";

import { formatPct, formatPrice, formatToman, symbolLabel } from "@/lib/format";

import { PATTERN_LABELS } from "@/lib/strategy/patterns";
import { cn } from "@/lib/utils";
import type { SymbolScan } from "@/lib/types";

import { analyzeOpportunity, fetchJevStatus } from "@/lib/ai";

import type { JevAnalysis } from "@/lib/ai";

const STATUS_META: Record<
  SymbolScan["status"],
  { label: string; cls: string }
> = {
  qualified: {
    label: "واجد شرایط",
    cls: "bg-profit/15 text-profit",
  },

  watching: {
    label: "در حال پایش",
    cls: "bg-secondary text-muted-foreground",
  },

  blocked: {
    label: "مسدود",
    cls: "bg-warn/15 text-warn",
  },

  error: {
    label: "خطا",
    cls: "bg-loss/15 text-loss",
  },
};

export default function Opportunities() {
  const engine = useEngine();

  const scans = useEngineState((e) => Object.values(e.scans));

  const [open, setOpen] = useState<string | null>(null);

  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const [aiResults, setAiResults] = useState<Record<string, JevAnalysis>>({});

  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});

  async function runJev(scan: SymbolScan) {
    setAiLoading(scan.symbol);

    setAiErrors((current) => ({
      ...current,
      [scan.symbol]: "",
    }));

    try {
      const result = await analyzeOpportunity(scan);

      setAiResults((current) => ({
        ...current,
        [scan.symbol]: result,
      }));
    } catch (error) {
      setAiErrors((current) => ({
        ...current,
        [scan.symbol]: (error as Error).message,
      }));
    } finally {
      setAiLoading(null);
    }
  }

  const sorted = scans.slice().sort((a, b) => {
    const qa = a.signal?.qualified ? 1 : 0;

    const qb = b.signal?.qualified ? 1 : 0;

    if (qa !== qb) return qb - qa;

    return (
      (b.signal?.score ?? 0) - (a.signal?.score ?? 0) ||
      a.liquidityRank - b.liquidityRank
    );
  });

  const qualifiedCount = sorted.filter((s) => s.signal?.qualified).length;

  const [aiReady, setAiReady] = useState(false);

  const autoAnalyzed = useRef<Set<string>>(new Set());

  const autoRunning = useRef(false);

  useEffect(() => {
    let cancelled = false;

    fetchJevStatus()
      .then((status) => {
        if (!cancelled) setAiReady(status.ready);
      })

      .catch(() => {
        if (!cancelled) setAiReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!aiReady || autoRunning.current) return;

    const pending = sorted.filter(
      (scan) =>
        scan.signal &&
        !autoAnalyzed.current.has(scan.symbol) &&
        !aiResults[scan.symbol],
    );

    if (!pending.length) return;

    autoRunning.current = true;

    void (async () => {
      for (const scan of pending) {
        autoAnalyzed.current.add(scan.symbol);

        await runJev(scan);
      }

      autoRunning.current = false;
    })();
  }, [aiReady, scans, sorted, aiResults]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold">فرصت‌های واجد شرایط</h1>

          {aiReady ? (
            <Badge
              variant="outline"
              className="w-fit rounded-full border-sky-500/30 px-2.5 py-0.5 text-[10px] text-sky-400"
            >
              تحلیل Jev فعال
            </Badge>
          ) : null}

          <p className="text-xs text-muted-foreground">
            نتیجه اسکن {sorted.length.toLocaleString("fa-IR")} نماد
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => void engine.tick()}
          disabled={engine.busy}
        >
          <RefreshCw
            className={
              engine.busy ? "ml-1 h-3.5 w-3.5 animate-spin" : "ml-1 h-3.5 w-3.5"
            }
          />
          اسکن مجدد
        </Button>
      </div>

      {!scans.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <EmptyOpportunities />

            <p className="text-sm text-muted-foreground">
              ربات هنوز بازاری اسکن نکرده است
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {sorted.map((scan) => {
          const signal = scan.signal;

          const meta = STATUS_META[scan.status];

          const expanded = open === scan.symbol;

          return (
            <Card
              key={scan.symbol}
              className={cn(
                "border-border/60",
                signal?.qualified && "border-profit/40",
              )}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      {symbolLabel(scan.symbol)}
                    </p>

                    <p className="text-[11px] text-muted-foreground">
                      حجم ۲۴ ساعت:{" "}
                      {scan.volume24h ? formatToman(scan.volume24h) : "—"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="num text-sm font-bold">
                      {scan.lastPrice ? formatPrice(scan.lastPrice) : "—"}
                    </span>

                    <span
                      className={cn(
                        "num text-xs font-bold",
                        scan.changePct24h >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      {formatPct(scan.changePct24h)}
                    </span>

                    <Badge
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px]",
                        meta.cls,
                      )}
                    >
                      {meta.label}
                    </Badge>
                  </div>
                </div>

                {signal ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full">
                        امتیاز ورود: {signal.score} از ۸
                      </Badge>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full border-sky-500/30 text-sky-400"
                        disabled={aiLoading === scan.symbol}
                        onClick={() => void runJev(scan)}
                      >
                        {aiLoading === scan.symbol ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <BrainCircuit />
                        )}
                        بررسی Jev
                      </Button>
                    </div>

                    {aiResults[scan.symbol] ? (
                      (() => {
                        const analysis = aiResults[scan.symbol];

                        const bestAction = Object.entries(
                          analysis.action.probabilities,
                        ).sort((a, b) => Number(b[1]) - Number(a[1]))[0];

                        const actionLabel = bestAction
                          ? analysis.action.legend[bestAction[0]]
                          : "نامشخص";

                        const riskColor =
                          analysis.risk.score >= 3
                            ? "text-red-400"
                            : analysis.risk.score >= 2
                              ? "text-yellow-400"
                              : "text-green-400";

                        return (
                          <div
                            className="
        mt-3
        rounded-xl
        border
        border-sky-500/20
        bg-sky-500/5
        p-3
        text-[11px]
      "
                          >
                            <p className="font-bold text-sky-400">تصمیم Jev</p>

                            <p className="mt-2">
                              امتیاز تصمیم: {analysis.decision.toFixed(2)}
                            </p>

                            <p>
                              ریسک:{" "}
                              <span className={riskColor}>
                                {analysis.risk.label}
                              </span>
                            </p>

                            <p>امتیاز ریسک: {analysis.risk.score.toFixed(2)}</p>

                            <p>
                              اطمینان:{" "}
                              {Math.round(analysis.risk.confidence * 100)}٪
                            </p>

                            <p>
                              عمل پیشنهادی:{" "}
                              <span className="font-bold text-sky-300">
                                {actionLabel}
                              </span>
                            </p>

                            <details className="mt-2">
                              <summary className="cursor-pointer text-muted-foreground">
                                احتمال اقدامات
                              </summary>

                              <div className="mt-2 space-y-1">
                                {Object.entries(analysis.action.legend).map(
                                  ([key, label]) => (
                                    <p key={key}>
                                      {label}:{" "}
                                      {Math.round(
                                        (analysis.action.probabilities[key] ??
                                          0) * 100,
                                      )}
                                      ٪
                                    </p>
                                  ),
                                )}
                              </div>
                            </details>
                          </div>
                        );
                      })()
                    ) : aiErrors[scan.symbol] ? (
                      <p className="mt-3 text-loss">
                        خطای Jev: {aiErrors[scan.symbol]}
                      </p>
                    ) : null}

                    <button
                      className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground"
                      onClick={() => setOpen(expanded ? null : scan.symbol)}
                    >
                      <ChevronDown
                        className={cn("h-3.5 w-3.5", expanded && "rotate-180")}
                      />
                      جزئیات
                    </button>

                    {expanded && (
                      <div className="mt-2 grid gap-1.5">
                        {signal.criteria.map((c) => (
                          <div
                            key={c.id}
                            className="rounded-lg border px-3 py-2 text-[11px]"
                          >
                            {c.passed ? (
                              <Check className="inline text-profit" />
                            ) : (
                              <X className="inline text-loss" />
                            )}{" "}
                            {c.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {scan.note}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
