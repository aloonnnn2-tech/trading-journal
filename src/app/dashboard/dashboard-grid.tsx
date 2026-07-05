"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  normalizeDashboardLayout,
  type DashboardLayout,
  type DashboardWidgetId,
  type WidgetSize,
} from "@/lib/dashboard/layout";

const SIZE_LABEL: Record<WidgetSize, string> = { sm: "S", md: "M", lg: "L" };
const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { sm: "md", md: "lg", lg: "sm" };
const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: "lg:col-span-2",
  md: "lg:col-span-3",
  lg: "lg:col-span-6",
};

const WIDGET_TITLES: Record<DashboardWidgetId, string> = {
  performance: "Performance",
  calendar: "This Month",
  recent_trades: "Recent Trades",
  best_worst_setup: "Best / Worst Setup",
  recent_notes: "Recent Notes",
  recent_emotions: "Recent Emotions",
};

// Native HTML5 drag-and-drop for reordering + a 3-state size cycle button
// for resizing -- satisfies the spec's "Small / Medium / Large" sizing
// requirement without pulling in a full grid-layout library for three
// widgets. Layout is persisted via PUT /api/settings/dashboard-layout,
// debounced the same way trade autosave debounces (see
// useAutosaveTrade) so dragging or resizing repeatedly doesn't spam writes.
export function DashboardGrid({
  initialLayout,
  widgets,
}: {
  initialLayout: DashboardLayout;
  widgets: Record<DashboardWidgetId, React.ReactNode>;
}) {
  const [layout, setLayout] = useState(() => normalizeDashboardLayout(initialLayout));
  const [draggingId, setDraggingId] = useState<DashboardWidgetId | null>(null);
  const [saveTimeout, setSaveTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  function persist(next: DashboardLayout) {
    if (saveTimeout) clearTimeout(saveTimeout);
    const timeout = setTimeout(() => {
      fetch("/api/settings/dashboard-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    }, 500);
    setSaveTimeout(timeout);
  }

  function reorder(targetId: DashboardWidgetId) {
    if (!draggingId || draggingId === targetId) return;
    const order = [...layout.order];
    const from = order.indexOf(draggingId);
    const to = order.indexOf(targetId);
    order.splice(from, 1);
    order.splice(to, 0, draggingId);
    const next = { ...layout, order };
    setLayout(next);
    persist(next);
  }

  function cycleSize(id: DashboardWidgetId) {
    const current = layout.sizes[id] ?? "md";
    const next = { ...layout, sizes: { ...layout.sizes, [id]: NEXT_SIZE[current] } };
    setLayout(next);
    persist(next);
  }

  return (
    <div className="grid gap-4 lg:grid-flow-dense lg:grid-cols-6">
      {layout.order.map((id) => {
        const size = layout.sizes[id] ?? "md";
        return (
          <motion.div
            key={id}
            layout
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            draggable
            onDragStart={() => setDraggingId(id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => reorder(id)}
            whileDrag={{ scale: 1.01, boxShadow: "0 16px 40px -16px rgba(0,0,0,0.4)" }}
            className={`${SIZE_SPAN[size]} rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] ${
              draggingId === id ? "opacity-50" : ""
            }`}
          >
            <div className="mb-4 flex cursor-move items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                {WIDGET_TITLES[id]}
              </h2>
              <button
                onClick={() => cycleSize(id)}
                title="Cycle widget size"
                className="rounded-md px-2 py-0.5 font-mono text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                {SIZE_LABEL[size]}
              </button>
            </div>
            {widgets[id]}
          </motion.div>
        );
      })}
    </div>
  );
}
