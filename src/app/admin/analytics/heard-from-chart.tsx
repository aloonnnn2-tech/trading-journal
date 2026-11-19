"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

// "How did you hear about us?" -- one bar per answer, most first. A single
// series, so one colour and no legend; each bar carries its count and share
// as a label, so the numbers are readable without hovering.
export function HeardFromChart({ data }: { data: { label: string; count: number; pct: number }[] }) {
  const rows = data.map((d) => ({ ...d, display: d.count === 0 ? "0" : `${d.count} · ${d.pct}%` }));
  return (
    <ResponsiveContainer width="100%" height={data.length * 40 + 16}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} horizontal={false} />
        <XAxis type="number" hide allowDecimals={false} domain={[0, (max: number) => Math.max(1, max)]} />
        <YAxis
          type="category"
          dataKey="label"
          tick={TICK}
          axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
          tickLine={false}
          width={110}
        />
        <Tooltip
          cursor={{ fill: "var(--color-subtle)", opacity: 0.35 }}
          formatter={(value, _name, item) => [`${value} (${(item.payload as { pct: number }).pct}% of answers)`, "Accounts"]}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey="count" fill={CHART.accent} radius={[0, 4, 4, 0]} maxBarSize={20} animationDuration={600}>
          {/* Drawn by hand: Recharts skips the label of a zero-length bar,
              and a channel nobody picked should still read "0", not blank. */}
          <LabelList
            dataKey="display"
            content={({ x, y, width, height, value }) => (
              <text
                x={Number(x ?? 0) + Number(width ?? 0) + 6}
                y={Number(y ?? 0) + Number(height ?? 0) / 2}
                dominantBaseline="central"
                fontSize={12}
                className="fill-zinc-600 dark:fill-zinc-300"
              >
                {String(value ?? "")}
              </text>
            )}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
