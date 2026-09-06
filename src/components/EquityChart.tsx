import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EquityPoint } from "@/lib/types";
import { formatDateTime, formatInt } from "@/lib/format";

/** نمودار منحنی سرمایه */
export function EquityChart({ data, height = 240 }: { data: EquityPoint[]; height?: number }) {
  const points = data.map((p) => ({ time: p.time, equity: Math.round(p.equity), label: formatDateTime(p.time) }));
  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(51,65,85,0.25)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#94A3B8", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={60} />
          <YAxis
            tick={{ fill: "#94A3B8", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={70}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => (Math.abs(v) >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : formatInt(v))}
          />
          <Tooltip
            contentStyle={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 12, direction: "rtl", fontFamily: "Vazirmatn" }}
            labelStyle={{ color: "#94A3B8", fontSize: 11 }}
            formatter={(value) => [`${formatInt(Number(value))} تومان`, "سرمایه"]}
          />
          <Area type="monotone" dataKey="equity" stroke="#10B981" strokeWidth={2} fill="url(#equityFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
