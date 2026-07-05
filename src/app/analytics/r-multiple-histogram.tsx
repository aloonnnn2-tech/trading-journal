"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import type { RMultipleBucket } from "@/lib/analytics/queries";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

export function RMultipleHistogram({ data }: { data: RMultipleBucket[] }) {
  const hasData = data.some((bucket) => bucket.count > 0);
  if (!hasData) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-zinc-500">
        No R-multiple data yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
        />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
        <Tooltip
          cursor={{ fill: "var(--color-subtle)", opacity: 0.35 }}
          formatter={(value) => [value, "Trades"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={600}>
          {data.map((bucket) => (
            <Cell key={bucket.label} fill={bucket.label.trim().startsWith("-") ? CHART.neg : CHART.pos} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
