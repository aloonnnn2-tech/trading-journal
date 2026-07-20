"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { TOUR_STEPS } from "@/lib/tour/steps";

const REPLAY_EVENT = "trading-lens:replay-tour";

export function startTour() {
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(targetId: string): Rect | null {
  const el = document.querySelector(`[data-tour-id="${targetId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourOverlay() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Without this, the effect below re-checks (and can re-launch) the tour
  // on every route change -- so ignoring the tour and clicking a nav link
  // would dismiss it (via the route-change effect further down) only to
  // have it immediately reappear once the fetch resolves. One check per
  // session is enough; has_completed_tour itself is what makes it "once
  // per user" across sessions.
  const autoCheckedRef = useRef(false);

  // First-run check: skip entirely on public (logged-out) pages, and only
  // auto-launch once per user (has_completed_tour flips true on finish/skip).
  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname)) return;
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    fetch("/api/settings/tour")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.hasCompletedTour) setActive(true);
      })
      .catch(() => {
        // No connectivity / not signed in yet -- just don't auto-launch.
      });
  }, [pathname]);

  useEffect(() => {
    function onReplay() {
      setStepIndex(0);
      setActive(true);
    }
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    fetch("/api/settings/tour", { method: "PATCH" }).catch(() => {
      // Best-effort -- worst case the tour auto-launches again next visit.
    });
  }, []);

  // A route change mid-tour means the current step's target may no longer
  // exist (or the user navigated away on purpose) -- close rather than
  // point at a stale element.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(false);
  }, [pathname]);

  const step = TOUR_STEPS[stepIndex];

  useEffect(() => {
    if (!active || !step) return;

    function update() {
      const measured = measure(step.targetId);
      setRect(measured);
    }
    update();

    const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, finish]);

  if (!active || !step || !rect) return null;

  const padding = 6;
  const spotlightStyle: React.CSSProperties = {
    position: "fixed",
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
    borderRadius: 10,
    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
    pointerEvents: "none",
    zIndex: 100,
  };

  const tooltipTop = rect.top + rect.height + padding + 10;
  const tooltipLeft = Math.min(Math.max(rect.left - padding, 16), window.innerWidth - 320 - 16);

  return (
    <AnimatePresence>
      <motion.div
        key="spotlight"
        style={spotlightStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        key={`tooltip-${stepIndex}`}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2 }}
        style={{ position: "fixed", top: tooltipTop, left: tooltipLeft, zIndex: 101, width: 320 }}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-subtle dark:bg-card"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{step.title}</h3>
          <button
            onClick={finish}
            aria-label="Skip tour"
            className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex((i) => i - 1)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (stepIndex < TOUR_STEPS.length - 1 ? setStepIndex((i) => i + 1) : finish())}
              className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:brightness-110 dark:text-zinc-950"
            >
              {stepIndex < TOUR_STEPS.length - 1 ? "Next" : "Finish"}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
