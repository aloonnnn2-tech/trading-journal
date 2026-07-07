"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import type { FeatureUsageRow } from "@/lib/tracking/admin-queries";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

export function FeatureUsageChart({ data }: { data: FeatureUsageRow[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-zinc-500">
        No feature events recorded yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(260, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} horizontal={false} />
        <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="eventName"
          tick={TICK}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
          width={140}
        />
        <Tooltip
          cursor={{ fill: "var(--color-subtle)", opacity: 0.35 }}
          formatter={(value) => [value, "Events"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" fill={CHART.accent} radius={[0, 4, 4, 0]} maxBarSize={20} animationDuration={600} />
      </BarChart>
    </ResponsiveContainer>
  );
}
