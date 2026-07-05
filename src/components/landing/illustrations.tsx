// Hand-built product illustrations for the landing page. These are drawn
// with real HTML + SVG against the theme tokens instead of raster
// screenshots, so they stay crisp on every display, follow light/dark mode,
// and never go stale when the app UI evolves.

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
          <span className="h-1.5 w-1.5 rounded-full bg-profit" />
          <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">live</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "ink",
  meter,
}: {
  label: string;
  value: string;
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
      <p className={`tnum mt-0.5 truncate font-mono text-sm font-semibold ${color}`}>{value}</p>
      {meter !== undefined && (
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${meter * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Jagged equity path — deliberately not smoothed; real P/L curves are jagged.
const EQUITY_POINTS =
  "0,128 28,122 56,127 84,114 112,119 140,104 168,110 196,117 224,98 252,103 280,88 308,94 336,74 364,80 392,62 420,68 448,46 476,52 504,30";
const DRAWDOWN_POINTS =
  "0,150 56,153 84,158 140,150 196,161 252,155 308,164 364,157 420,166 476,158 504,162";

function EquityChartSvg({ withDrawdown = false }: { withDrawdown?: boolean }) {
  return (
    <svg viewBox="0 0 504 176" className="w-full" aria-hidden="true">
      {/* hairline grid */}
      {[24, 64, 104, 144].map((y) => (
        <line key={y} x1="0" x2="504" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
      ))}
      {/* y labels */}
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
      {/* area wash */}
      <polygon points={`${EQUITY_POINTS} 504,148 0,148`} fill="var(--chart-pos)" opacity="0.1" />
      {/* equity line */}
      <polyline
        points={EQUITY_POINTS}
        fill="none"
        stroke="var(--chart-pos)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* end marker with surface ring */}
      <circle cx="504" cy="30" r="5.5" fill="var(--color-card)" />
      <circle cx="504" cy="30" r="3.5" fill="var(--chart-pos)" />
      {withDrawdown && (
        <polyline
          points={DRAWDOWN_POINTS}
          fill="none"
          stroke="var(--chart-neg)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// ——— Hero: the product shot ———

export function HeroPanel() {
  return (
    <PanelFrame label="dashboard — overview">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          <MiniStat label="Total P/L" value="+$4,928.61" tone="pos" />
          <MiniStat label="Win rate" value="54%" meter={0.54} />
          <MiniStat label="Profit factor" value="1.42" />
        </div>
        <EquityChartSvg />
        <div className="flex flex-col">
          {[
            ["NVDA", "long", "+$612.40", true],
            ["TSLA", "short", "−$248.91", false],
            ["COIN", "long", "+$891.75", true],
          ].map(([ticker, dir, pl, won]) => (
            <div
              key={ticker as string}
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
            </div>
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}

// ——— Feature story: analytics ———

const R_BUCKETS = [
  { label: "-2R", count: 2 },
  { label: "-1R", count: 5 },
  { label: "0R", count: 3 },
  { label: "+1R", count: 9 },
  { label: "+2R", count: 6 },
  { label: "+3R", count: 3 },
];

function RMultipleHistogramSvg() {
  const max = Math.max(...R_BUCKETS.map((b) => b.count));
  return (
    <svg viewBox="0 0 240 100" className="w-full" aria-hidden="true">
      <line x1="0" x2="240" y1="80" y2="80" stroke="var(--chart-axis)" strokeWidth="1" />
      {R_BUCKETS.map((b, i) => {
        const barHeight = (b.count / max) * 58;
        const x = 6 + i * 39;
        const color = b.label.startsWith("-")
          ? "var(--chart-neg)"
          : b.label === "0R"
            ? "var(--chart-ref)"
            : "var(--chart-pos)";
        return (
          <g key={b.label}>
            <rect x={x} y={80 - barHeight} width="26" height={barHeight} rx="3" fill={color} />
            <text
              x={x + 13}
              y="92"
              textAnchor="middle"
              fontSize="8"
              fontFamily="var(--font-geist-mono)"
              fill="var(--chart-muted)"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WinLossSizeSvg() {
  const avgWin = 612;
  const avgLoss = 284;
  const max = Math.max(avgWin, avgLoss);
  const winWidth = (avgWin / max) * 150;
  const lossWidth = (avgLoss / max) * 150;
  return (
    <svg viewBox="0 0 240 88" className="w-full" aria-hidden="true">
      <text x="0" y="10" fontSize="8" fontFamily="var(--font-geist-mono)" fill="var(--chart-muted)">
        avg win
      </text>
      <rect x="0" y="16" width={winWidth} height="16" rx="4" fill="var(--chart-pos)" />
      <text x={winWidth + 6} y="28" fontSize="9" fontFamily="var(--font-geist-mono)" fill="var(--chart-pos)">
        +$612
      </text>
      <text x="0" y="54" fontSize="8" fontFamily="var(--font-geist-mono)" fill="var(--chart-muted)">
        avg loss
      </text>
      <rect x="0" y="60" width={lossWidth} height="16" rx="4" fill="var(--chart-neg)" />
      <text x={lossWidth + 6} y="72" fontSize="9" fontFamily="var(--font-geist-mono)" fill="var(--chart-neg)">
        −$284
      </text>
    </svg>
  );
}

export function AnalyticsPanel() {
  return (
    <PanelFrame label="analytics — equity & drawdown">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
            Account value over time
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            max drawdown <span className="text-loss">−$2,651.01</span>
          </span>
        </div>
        <EquityChartSvg withDrawdown />
        <div className="flex items-center gap-4 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-profit" /> Equity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-loss" /> Drawdown
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-3 dark:border-subtle">
          <div>
            <p className="text-[9px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
              R-multiple distribution
            </p>
            <RMultipleHistogramSvg />
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
              Win / loss size
            </p>
            <WinLossSizeSvg />
          </div>
        </div>
      </div>
    </PanelFrame>
  );
}

// ——— Feature story: insights ———

const INSIGHT_BARS = [
  { label: "Mon", h: 26, hot: false },
  { label: "Tue", h: 44, hot: false },
  { label: "Wed", h: 58, hot: false },
  { label: "Thu", h: 38, hot: false },
  { label: "Fri", h: 78, hot: true },
];

export function InsightPanel() {
  return (
    <PanelFrame label="insights — pattern detection">
      <div className="flex flex-col gap-4 p-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Friday is your best day — 71% win rate.
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">7 trades on Fridays vs. 54% overall.</p>
        </div>
        <svg viewBox="0 0 280 100" className="w-full" aria-hidden="true">
          {[10, 40, 70].map((y) => (
            <line key={y} x1="0" x2="280" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
          ))}
          <line x1="0" x2="280" y1="86" y2="86" stroke="var(--chart-axis)" strokeWidth="1" />
          {INSIGHT_BARS.map((bar, i) => (
            <g key={bar.label}>
              <rect
                x={20 + i * 52}
                y={86 - bar.h}
                width="22"
                height={bar.h}
                rx="3"
                fill={bar.hot ? "var(--color-primary)" : "var(--chart-ref)"}
              />
              <text
                x={31 + i * 52}
                y="97"
                textAnchor="middle"
                fontSize="8"
                fontFamily="var(--font-geist-mono)"
                fill="var(--chart-muted)"
              >
                {bar.label}
              </text>
            </g>
          ))}
        </svg>
        <div className="flex flex-wrap gap-1.5">
          {["calm entries outperform", "shorts beat longs", "risk under 1% wins more"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-500 dark:border-subtle"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}

// ——— Feature story: dashboard / calendar heatmap ———

// Deterministic month of P/L intensities: sign × strength (0 = no trades).
const HEAT = [
  0, 0.3, 0, -0.2, 0.5, 0, 0,
  0.2, 0, -0.6, 0.4, 0, 0.8, 0,
  0, -0.3, 0.6, 0, 0.3, -0.15, 0,
  0.45, 0, 0.25, -0.8, 0.55, 0, 0,
  0, 0.35, 0, 0.7, -0.25, 0.4, 0,
];

export function CalendarPanel() {
  return (
    <PanelFrame label="dashboard — monthly p/l">
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-7 gap-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span
              key={i}
              className="text-center font-mono text-[9px] uppercase text-zinc-400 dark:text-zinc-600"
            >
              {d}
            </span>
          ))}
          {HEAT.map((v, i) => (
            <span
              key={i}
              className={`tnum flex aspect-square items-center justify-center rounded-md font-mono text-[9px] ${
                Math.abs(v) > 0.5 ? "text-white dark:text-zinc-950" : "text-zinc-600 dark:text-zinc-400"
              }`}
              style={
                v !== 0
                  ? {
                      background: `color-mix(in srgb, ${v > 0 ? "var(--chart-pos)" : "var(--chart-neg)"} ${Math.round(Math.abs(v) * 55 + 25)}%, transparent)`,
                    }
                  : undefined
              }
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Drag, resize, and rearrange every widget</span>
          <span className="flex gap-1">
            {["S", "M", "L"].map((s) => (
              <span
                key={s}
                className={`rounded border px-1.5 py-0.5 font-mono ${
                  s === "M"
                    ? "border-primary text-primary"
                    : "border-zinc-200 text-zinc-400 dark:border-subtle"
                }`}
              >
                {s}
              </span>
            ))}
          </span>
        </div>
      </div>
    </PanelFrame>
  );
}
