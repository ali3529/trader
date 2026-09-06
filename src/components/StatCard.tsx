import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: "neutral" | "profit" | "loss" | "warn";
}

const TONE_CLASS = {
  neutral: "text-foreground",
  profit: "text-profit",
  loss: "text-loss",
  warn: "text-warn",
} as const;

export function StatCard({ title, value, sub, icon: Icon, tone = "neutral" }: StatCardProps) {
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{title}</p>
          <p className={cn("num mt-1 truncate text-lg font-bold", TONE_CLASS[tone])}>{value}</p>
          {sub ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
        <div className="rounded-xl bg-secondary/70 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}
