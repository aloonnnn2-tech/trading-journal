"use client";

import { motion } from "framer-motion";
import type { DailyPL } from "@/lib/dashboard/queries";
import { staggerContainer, fadeInUp } from "@/components/motion/variants";

// P/L heatmap calendar: wash opacity scales with the day's |P/L| relative to
// the month's largest move, so big days read at a glance. The exact figure
// lives in the tooltip (title) — color is reinforcement, not the only channel.
export function MonthlyCalendar({
  year,
  month,
  dailyPL,
}: {
  year: number;
  month: number; // 0-indexed
  dailyPL: DailyPL[];
}) {
  const byDay = new Map(dailyPL.map((d) => [d.day, d.dollar_pl]));
  const maxAbs = Math.max(1, ...dailyPL.map((d) => Math.abs(d.dollar_pl)));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{monthLabel}</p>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[3px] bg-profit/70" /> Gain
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[3px] bg-loss/70" /> Loss
          </span>
        </div>
      </div>
      <motion.div
        variants={staggerContainer(0.012)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-7 gap-1 text-center text-xs"
      >
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="py-1 text-[10px] font-medium uppercase text-zinc-400 dark:text-zinc-600">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const pl = byDay.get(day);
          const isToday = isThisMonth && day === today.getDate();
          // Wash strength: 0.15 floor so small days still register, scaled to the month's max.
          const strength = pl === undefined ? 0 : 0.15 + 0.55 * (Math.abs(pl) / maxAbs);
          const washColor =
            pl === undefined
              ? undefined
              : pl > 0
                ? `color-mix(in srgb, var(--chart-pos) ${Math.round(strength * 100)}%, transparent)`
                : pl < 0
                  ? `color-mix(in srgb, var(--chart-neg) ${Math.round(strength * 100)}%, transparent)`
                  : "color-mix(in srgb, var(--chart-muted) 20%, transparent)";
          return (
            <motion.div
              key={i}
              variants={fadeInUp}
              whileHover={{ scale: 1.06 }}
              className={`tnum cursor-default rounded-md py-1.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 ${
                isToday ? "ring-1 ring-primary" : ""
              }`}
              style={washColor ? { background: washColor } : undefined}
              title={pl !== undefined ? `${pl < 0 ? "−" : "+"}$${Math.abs(pl).toFixed(2)}` : undefined}
            >
              {day}
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
