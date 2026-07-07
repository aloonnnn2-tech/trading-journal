"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import type { UsagePoint } from "@/lib/tracking/admin-queries";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

export function UsageLineChart({ data }: { data: UsagePoint[] }) {
  const hasData = data.some((point) => point.signups > 0 || point.dau > 0);
  if (!hasData) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-zinc-500">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="day"
          tick={TICK}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
          minTickGap={48}
          tickFormatter={(v) => new Date(String(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
        <Tooltip
          labelFormatter={(label) => new Date(String(label)).toLocaleDateString()}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: CHART.muted }} />
        <Line
          type="monotone"
          dataKey="signups"
          name="Signups"
          stroke={CHART.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
          animationDuration={700}
        />
        <Line
          type="monotone"
          dataKey="dau"
          name="Active users"
          stroke={CHART.pos}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
          animationDuration={700}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
