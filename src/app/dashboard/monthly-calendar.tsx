"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { DailyPL } from "@/lib/dashboard/queries";
import { useMounted } from "@/lib/use-mounted";
import { formatMoney } from "@/lib/format/money";

// Locale-free month names: `toLocaleDateString` renders under Node's locale
// on the server and the browser's on the client, and the two need not agree.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

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
  // "Today" depends on the clock and the zone, so the highlight is applied
  // only after hydration; see use-mounted.ts.
  const mounted = useMounted();
  const today = new Date();
  const isThisMonth = mounted && today.getFullYear() === year && today.getMonth() === month;
  const monthLabel = `${MONTH_NAMES[month]} ${year}`;
  // A tapped day. The tooltip (title) is mouse-only; on a phone this line
  // under the grid is the only way to read a day's exact figure.
  const [picked, setPicked] = useState<number | null>(null);

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div data-shot="calendar">
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
      {/* The day cells used to fade in on a 12ms stagger from `opacity: 0`.
          Across a 31-day month that is the P/L wash arriving a cell at a time
          on a panel whose whole job is to be read at a glance (issue 7 of
          docs/design-audit.md). The hover lift stays. */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="py-1 text-[10px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
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
            <motion.button
              type="button"
              key={i}
              whileHover={{ scale: 1.06 }}
              onClick={() => setPicked(pl !== undefined ? day : null)}
              aria-label={pl !== undefined ? `${MONTH_NAMES[month]} ${day}: ${formatMoney(pl, { sign: "always" })}` : undefined}
              className={`tnum cursor-default rounded-md py-1.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300 ${
                isToday ? "ring-1 ring-primary" : ""
              }`}
              style={washColor ? { background: washColor } : undefined}
              title={pl !== undefined ? formatMoney(pl, { sign: "always" }) : undefined}
            >
              {day}
            </motion.button>
          );
        })}
      </div>
      {picked !== null && byDay.has(picked) && (
        <p role="status" className="mt-2 text-center text-xs text-zinc-600 dark:text-zinc-300">
          {MONTH_NAMES[month]} {picked}:{" "}
          <span className={`tnum font-mono ${(byDay.get(picked) ?? 0) >= 0 ? "text-profit" : "text-loss"}`}>
            {formatMoney(byDay.get(picked), { sign: "always" })}
          </span>
        </p>
      )}
    </div>
  );
}
