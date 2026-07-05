"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer } from "recharts";
import type { PerformancePoint } from "@/lib/dashboard/queries";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

export function PerformanceChart({ data }: { data: PerformancePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-zinc-500">
        No closed trades yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="perfWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.pos} stopOpacity={0.14} />
            <stop offset="100%" stopColor={CHART.pos} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="date"
          tick={TICK}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
          minTickGap={64}
          tickFormatter={(v) =>
            new Date(String(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          }
        />
        <YAxis
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={56}
          tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
        />
        <ReferenceLine y={0} stroke={CHART.axis} strokeWidth={1} />
        <Tooltip
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cumulative P/L"]}
          labelFormatter={(label) => new Date(String(label)).toLocaleDateString()}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke={CHART.pos}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="url(#perfWash)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
