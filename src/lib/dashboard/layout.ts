export type WidgetSize = "sm" | "md" | "lg";

export const DASHBOARD_WIDGET_IDS = [
  "performance",
  "calendar",
  "recent_trades",
  "best_worst_setup",
  "recent_notes",
  "recent_emotions",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface DashboardLayout {
  order: DashboardWidgetId[];
  sizes: Partial<Record<DashboardWidgetId, WidgetSize>>;
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  order: ["performance", "calendar", "recent_trades", "best_worst_setup", "recent_notes", "recent_emotions"],
  sizes: {
    performance: "lg",
    calendar: "md",
    recent_trades: "lg",
    best_worst_setup: "md",
    recent_notes: "md",
    recent_emotions: "md",
  },
};

// Merges a possibly-partial/stale stored layout (e.g. saved before a new
// widget existed) with the default so the grid always has every known
// widget exactly once, in a stable order.
export function normalizeDashboardLayout(stored: Partial<DashboardLayout> | null | undefined): DashboardLayout {
  const storedOrder = (stored?.order ?? []).filter((id): id is DashboardWidgetId =>
    DASHBOARD_WIDGET_IDS.includes(id as DashboardWidgetId),
  );
  const missing = DASHBOARD_WIDGET_IDS.filter((id) => !storedOrder.includes(id));
  return {
    order: [...storedOrder, ...missing],
    sizes: { ...DEFAULT_DASHBOARD_LAYOUT.sizes, ...stored?.sizes },
  };
}
