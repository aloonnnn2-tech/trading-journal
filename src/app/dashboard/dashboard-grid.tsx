"use client";

import { useEffect, useRef, useState } from "react";
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
  const [saveFailed, setSaveFailed] = useState(false);
  // A ref, not state: the timer id isn't rendered, and holding it in state
  // forced an extra re-render per reorder. Cleared on unmount so a pending
  // save can't fire into a gone component.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    },
    [],
  );

  function persist(next: DashboardLayout) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // Failures were fire-and-forget before, which read as "my layout
      // doesn't stick": the drag felt saved, then reverted on next load
      // with no signal. Now it says so; any later successful save clears it.
      fetch("/api/settings/dashboard-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
        .then((res) => setSaveFailed(!res.ok))
        .catch(() => setSaveFailed(true));
    }, 500);
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
      {saveFailed && (
        <p role="status" className="col-span-full text-xs text-loss">
          Layout changes couldn&apos;t be saved. They&apos;ll revert on reload. Check your connection and move a widget again to retry.
        </p>
      )}
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
                className="rounded-md px-2 py-0.5 font-mono text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
