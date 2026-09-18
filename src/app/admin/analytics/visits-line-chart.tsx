"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import type { PublicViewPoint } from "@/lib/tracking/admin-queries";
import { CHART, TICK, TOOLTIP_STYLE } from "@/lib/theme/colors";

// Anonymous homepage views beside signups, per day. The gap between the two
// lines is the funnel: everyone who arrived and did not create an account.
// Views are a raw count (a refresh counts again -- see public-view-beacon.tsx
// for why that is the deliberate cost of storing nothing about the visitor).
export function VisitsLineChart({ data }: { data: PublicViewPoint[] }) {
  const hasData = data.some((point) => point.views > 0 || point.signups > 0);
  if (!hasData) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-zinc-500">
        No homepage visits recorded yet.
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
          tickFormatter={(v) =>
            new Date(String(v)).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              // Plain Postgres `date`, rendered in UTC for the same reason as
              // usage-line-chart.tsx.
              timeZone: "UTC",
            })
          }
        />
        <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
        <Tooltip
          labelFormatter={(label) => new Date(String(label)).toLocaleDateString(undefined, { timeZone: "UTC" })}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: CHART.muted }} />
        <Line
          type="monotone"
          dataKey="views"
          name="Homepage views"
          stroke={CHART.muted}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }}
          animationDuration={700}
        />
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
      </LineChart>
    </ResponsiveContainer>
  );
}
