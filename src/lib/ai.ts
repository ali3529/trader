import type { SymbolScan } from "./types";

export interface QwenStatus {
  reachable: boolean;
  ready: boolean;
  model: string;
  installedModels: string[];
  error?: string;
}

export interface QwenAnalysis {
  summary: string;
  verdict: "support" | "neutral" | "caution";
  confidence: number;
  observations: string[];
  risks: string[];
}

export async function fetchQwenStatus(): Promise<QwenStatus> {
  const response = await fetch("/api/ai/status", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<QwenStatus>;
}

export async function analyzeOpportunity(scan: SymbolScan): Promise<QwenAnalysis> {
  if (!scan.signal) throw new Error("سیگنالی برای تحلیل وجود ندارد");
  const response = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: scan.symbol,
      price: scan.lastPrice,
      changePct24h: scan.changePct24h,
      volume24h: scan.volume24h,
      signal: scan.signal,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { statusMessage?: string; message?: string } | null;
    throw new Error(body?.statusMessage ?? body?.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<QwenAnalysis>;
}
