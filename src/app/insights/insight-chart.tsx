"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

// The highlighted segment wears the accent; the comparison bars sit in the
// de-emphasis neutral so the story bar is the only loud thing on the card.
export function InsightChart({
  data,
  highlightLabel,
}: {
  data: { label: string; winRate: number; trades: number }[];
  highlightLabel: string;
}) {
  const chartData = data.map((d) => ({ ...d, winRatePercent: Math.round(d.winRate * 1000) / 10 }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ ...TICK, fontFamily: "var(--font-inter)" }}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
        />
        <YAxis
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          cursor={{ fill: "var(--color-subtle)", opacity: 0.35 }}
          formatter={(value, _name, item) => [`${value}% (${item.payload.trades} trades)`, "Win rate"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="winRatePercent" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500}>
          {chartData.map((d) => (
            <Cell key={d.label} fill={d.label === highlightLabel ? CHART.accent : CHART.ref} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
