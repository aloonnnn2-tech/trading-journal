// Chart colors as CSS custom-property references. Recharts forwards these
// strings to SVG presentation attributes, where var() resolves against the
// active theme — so every chart follows light/dark automatically instead of
// being hard-coded to one mode.
export const CHART = {
  pos: "var(--chart-pos)",
  neg: "var(--chart-neg)",
  accent: "var(--color-primary)",
  ref: "var(--chart-ref)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  muted: "var(--chart-muted)",
} as const;

// Shared axis-tick style: muted ink, small, tabular figures.
export const TICK = {
  fontSize: 11,
  fill: CHART.muted,
  fontFamily: "var(--font-geist-mono)",
} as const;

// Shared tooltip chrome — themed card surface, hairline border.
export const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-subtle)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "0 8px 24px -12px rgba(0,0,0,0.35)",
};
