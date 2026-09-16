"use client";

import { motion } from "framer-motion";
import { CountUp } from "@/components/landing/v2/CountUp";

// The hero panel for /home-v2. A copy of the hero pieces from
// ../illustrations.tsx (which stay untouched so the current homepage keeps
// rendering exactly as it does) with additions from the TradeStats teardown:
// the "live" pip pulses, the equity chart carries a baked-in hover tooltip,
// and on load the panel behaves like a dashboard coming to life -- the line
// draws itself, the figures count up, the meter fills.

function PanelFrame({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_48px_-24px_rgba(28,27,24,0.35)] dark:border-subtle dark:bg-card ${className}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-subtle">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </span>
          <span className="font-mono text-[11px] lowercase tracking-tight text-zinc-400 dark:text-zinc-500">
            {label}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-60" />
            <span className="relative h-1.5 w-1.5 animate-pulse rounded-full bg-profit" />
          </span>
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">live</span>
        </span>
      </div>
      {children}
    </div>
  );
}

// When the panel has faded in and the figures start moving. Everything in the
// panel is timed from here so it reads as one sequence, not three effects.
const START = 0.6;

function MiniStat({
  label,
  value,
  format,
  tone = "ink",
  meter,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  tone?: "ink" | "pos" | "neg";
  meter?: number;
}) {
  const color =
    tone === "pos" ? "text-profit" : tone === "neg" ? "text-loss" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-zinc-100 px-3 py-2 dark:border-subtle">
      <p className="truncate text-[9px] font-medium uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p className={`tnum mt-0.5 truncate font-mono text-sm font-semibold ${color}`}>
        <CountUp to={value} format={format} delay={START} />
      </p>
      {meter !== undefined && (
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <motion.div
            className="h-full origin-left rounded-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${meter * 100}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.2, delay: START, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
}

const money = (v: number) =>
  `+$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (v: number) => `${Math.round(v)}%`;
const ratio = (v: number) => v.toFixed(2);

const EQUITY_POINTS =
  "0,128 28,122 56,127 84,114 112,119 140,104 168,110 196,117 224,98 252,103 280,88 308,94 336,74 364,80 392,62 420,68 448,46 476,52 504,30";

// The point the tooltip is anchored to. It is one of EQUITY_POINTS, so the
// marker sits exactly on the line rather than floating beside it.
const HOVER_X = 420;
const HOVER_Y = 68;

function EquityChartSvg() {
  return (
    <svg viewBox="0 0 504 176" className="w-full" aria-hidden="true">
      {[24, 64, 104, 144].map((y) => (
        <line key={y} x1="0" x2="504" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
      ))}
      {[
        ["$6k", 28],
        ["$4k", 68],
        ["$2k", 108],
        ["$0", 148],
      ].map(([t, y]) => (
        <text
          key={t}
          x="4"
          y={Number(y) - 6}
          fontSize="9"
          fontFamily="var(--font-geist-mono)"
          fill="var(--chart-muted)"
        >
          {t}
        </text>
      ))}
      {/* The line draws itself left to right; the wash, the end marker and
          the tooltip follow once it has passed them. */}
      <motion.polygon
        points={`${EQUITY_POINTS} 504,148 0,148`}
        fill="var(--chart-pos)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.1 }}
        transition={{ duration: 0.6, delay: START + 1.2 }}
      />
      <motion.polyline
        points={EQUITY_POINTS}
        fill="none"
        stroke="var(--chart-pos)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, delay: START, ease: "easeInOut" }}
      />
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: START + 1.4 }}>
        <circle cx="504" cy="30" r="5.5" fill="var(--color-card)" />
        <circle cx="504" cy="30" r="3.5" fill="var(--chart-pos)" />
      </motion.g>

      {/* Hover tooltip, drawn in the same SVG so it scales with the chart. */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: START + 1.25, ease: "easeOut" }}
      >
        <line
          x1={HOVER_X}
          x2={HOVER_X}
          y1="30"
          y2={HOVER_Y - 6}
          stroke="var(--chart-axis)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <circle cx={HOVER_X} cy={HOVER_Y} r="5.5" fill="var(--color-card)" />
        <circle cx={HOVER_X} cy={HOVER_Y} r="3.5" fill="var(--color-primary)" />
        <rect
          x={HOVER_X - 80}
          y="8"
          width="160"
          height="22"
          rx="5"
          fill="var(--color-card)"
          stroke="var(--color-subtle)"
          strokeWidth="1"
        />
        <text
          x={HOVER_X}
          y="22.5"
          textAnchor="middle"
          fontSize="9"
          fontFamily="var(--font-geist-mono)"
          fill="var(--chart-muted)"
        >
          Jun 4 · 2:15 PM · +$1,240
        </text>
      </motion.g>
    </svg>
  );
}

export function HeroPanel() {
  return (
    <PanelFrame label="dashboard / overview">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          <MiniStat label="Total P/L" value={4928.61} format={money} tone="pos" />
          <MiniStat label="Win rate" value={54} format={percent} meter={0.54} />
          <MiniStat label="Profit factor" value={1.42} format={ratio} />
        </div>
        <EquityChartSvg />
        <div className="flex flex-col">
          {[
            ["NVDA", "long", "+$612.40", true],
            ["TSLA", "short", "−$248.91", false],
            ["COIN", "long", "+$891.75", true],
          ].map(([ticker, dir, pl, won], i) => (
            <motion.div
              key={ticker as string}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: START + 1.5 + i * 0.12, ease: "easeOut" }}
              className="flex items-center justify-between border-t border-zinc-100 py-1.5 first:border-0 dark:border-subtle"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium text-zinc-900 dark:text-zinc-100">
                  {ticker}
                </span>
                <span className="rounded-full border border-zinc-200 px-1.5 text-[9px] uppercase text-zinc-400 dark:border-subtle dark:text-zinc-500">
                  {dir}
                </span>
              </span>
              <span className={`tnum font-mono text-[11px] ${won ? "text-profit" : "text-loss"}`}>
                {pl}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}
