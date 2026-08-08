"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { TOUR_STEPS, type TourStep } from "@/lib/tour/steps";
import { WelcomeModal } from "./welcome-modal";

const REPLAY_EVENT = "trading-lens:replay-tour";

// Replaying (nav-bar HelpCircle icon) skips straight to the spotlight walk --
// the welcome screen is only for a user's genuine first login, gated by
// has_completed_tour below.
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

type Phase = "idle" | "welcome" | "touring";

// Whether a step belongs on the route we're currently looking at. Steps with
// neither field (the ones inside the Quick Trade modal) belong wherever the
// modal happens to be open.
function matchesPath(step: TourStep, pathname: string): boolean {
  if (step.pathPrefix) return pathname.startsWith(step.pathPrefix);
  if (step.path) return pathname === step.path;
  return true;
}

// Declining to open the Quick Trade modal has to skip every step that only
// exists inside it, not just the next one -- landing on a step whose target
// can never appear would leave the tour waiting forever on nothing.
function indexAfterSkipping(from: number): number {
  let i = from + 1;
  while (i < TOUR_STEPS.length && (TOUR_STEPS[i].awaitAction || !TOUR_STEPS[i].path)) i++;
  return i;
}

const POLL_MS = 50;
const TARGET_TIMEOUT_MS = 2000;
// Roughly the tallest a step tooltip gets; used only to decide which side of
// the target to place it on.
const TOOLTIP_SPACE_NEEDED = 240;
// Never let the tooltip be pushed so far that less than this much of it is
// on screen -- it's position:fixed, so off-screen means unreachable.
const MIN_TOOLTIP_VISIBLE = 160;

export function TourOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [stepIndex, setStepIndexState] = useState(0);
  // Tagged with the target it was measured from so a stale rect from the
  // previous step is never drawn under the current step's tooltip.
  const [spotlight, setSpotlight] = useState<{ targetId: string; rect: Rect } | null>(null);

  // One check per session; has_completed_tour itself is what makes it "once
  // per user" across sessions.
  const autoCheckedRef = useRef(false);
  // Set right before the tour calls router.push for its own step navigation,
  // so the "user navigated away" effect below doesn't mistake the tour's own
  // page change for the user bailing out.
  const expectingNavRef = useRef(false);
  // Mirrors `phase` so effects can read it without a render in between.
  // Effects in the same commit all see the pre-update `phase` value, and the
  // route-change effect below has to be able to stop the step effect from
  // acting on a tour it just closed -- otherwise clicking a nav link mid-tour
  // closed the tour but the step effect still fired its router.push and
  // yanked the user straight back to the step's page.
  const phaseRef = useRef<Phase>("idle");
  // Same reason as phaseRef: the route-change effect needs the current step
  // without waiting for a render.
  const stepIndexRef = useRef(0);
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const setStepIndex = useCallback((next: number) => {
    stepIndexRef.current = next;
    setStepIndexState(next);
  }, []);

  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname)) return;
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    fetch("/api/settings/tour")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.hasCompletedTour) setPhase("welcome");
      })
      .catch(() => {
        // No connectivity / not signed in yet -- just don't auto-launch.
      });
  }, [pathname, setPhase]);

  useEffect(() => {
    function onReplay() {
      setStepIndex(0);
      setPhase("touring");
    }
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [setPhase, setStepIndex]);

  const finish = useCallback(() => {
    setPhase("idle");
    fetch("/api/settings/tour", { method: "PATCH" }).catch(() => {
      // Best-effort -- worst case the tour auto-launches again next visit.
    });
  }, [setPhase]);

  const startTouring = useCallback(() => {
    setStepIndex(0);
    setPhase("touring");
  }, [setPhase, setStepIndex]);

  // A pathname change the tour didn't request is usually the user navigating
  // away on purpose -- close rather than point at a stale element. The
  // exception is the user completing the step's own action: creating a trade
  // pushes to /trades/<id>, which is exactly where the next step lives, so
  // that advances the tour instead of ending it.
  useEffect(() => {
    if (expectingNavRef.current) {
      expectingNavRef.current = false;
      return;
    }
    if (phaseRef.current !== "touring") return;

    const next = TOUR_STEPS[stepIndexRef.current + 1];
    if (next?.awaitAction && matchesPath(next, pathname)) {
      setStepIndex(stepIndexRef.current + 1);
      return;
    }
    setPhase("idle");
  }, [pathname, setPhase, setStepIndex]);

  const step = phase === "touring" ? TOUR_STEPS[stepIndex] : undefined;
  const nextStep = phase === "touring" ? TOUR_STEPS[stepIndex + 1] : undefined;

  // Drives the current step: navigates to its page if we're not already
  // there, then polls for its target element (the page may still be
  // client-rendering right after navigation) before spotlighting it.
  useEffect(() => {
    // phaseRef, not phase: the route-change effect above may have just closed
    // the tour in this same commit, and this effect would still see the old
    // `phase` value.
    if (phaseRef.current !== "touring" || phase !== "touring" || !step) return;

    if (!matchesPath(step, pathname)) {
      // A prefix step is only ever reached by the user completing the
      // previous action; there's no concrete URL to navigate to, so if we're
      // not already on it (they hit Skip instead) just move past it.
      if (!step.path) {
        const skip = setTimeout(() => {
          if (stepIndex < TOUR_STEPS.length - 1) setStepIndex(stepIndex + 1);
          else finish();
        }, 0);
        return () => clearTimeout(skip);
      }
      expectingNavRef.current = true;
      router.push(step.path);
      return;
    }

    const targetId = step.targetId;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let elapsed = 0;
    let detachLiveTracking: (() => void) | null = null;

    function track(measured: Rect) {
      setSpotlight({ targetId, rect: measured });
      document
        .querySelector(`[data-tour-id="${targetId}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });

      // Keeping the highlight on its target turned out to need belt and
      // braces. Scroll/resize events alone are what the first version used,
      // and they can silently never fire -- the highlight then sat where the
      // target used to be and slid further off the more the page scrolled,
      // which is the drift this is fixing. A rAF loop alone isn't enough
      // either: it's throttled to a crawl whenever the page isn't painting.
      // So all three drive the same measurement, and since a render only
      // happens when the rect actually moved, the redundancy is free.
      let previous = measured;
      let missingTicks = 0;
      function sync() {
        const next = measure(targetId);
        if (!next) {
          // The target went away mid-step -- the user closed the dialog it
          // lived in. Allow a moment (a re-render can briefly detach it),
          // then move on rather than leaving an invisible, stuck tour.
          if (++missingTicks > 12) {
            if (stepIndex < TOUR_STEPS.length - 1) setStepIndex(stepIndex + 1);
            else finish();
          }
          return;
        }
        missingTicks = 0;
        if (
          next.top !== previous.top ||
          next.left !== previous.left ||
          next.width !== previous.width ||
          next.height !== previous.height
        ) {
          previous = next;
          setSpotlight({ targetId, rect: next });
        }
      }

      let frame = requestAnimationFrame(function loop() {
        sync();
        frame = requestAnimationFrame(loop);
      });
      const ticker = setInterval(sync, 50);
      window.addEventListener("resize", sync);
      window.addEventListener("scroll", sync, true);
      detachLiveTracking = () => {
        cancelAnimationFrame(frame);
        clearInterval(ticker);
        window.removeEventListener("resize", sync);
        window.removeEventListener("scroll", sync, true);
      };
    }

    function poll() {
      if (cancelled || !step) return;
      const measured = measure(targetId);
      if (measured) {
        track(measured);
        return;
      }

      // An awaitAction target doesn't exist until the user acts (opens the
      // Quick Trade modal). Waiting forever is the point -- timing out would
      // skip the very step we're asking them to perform.
      if (!step.awaitAction) {
        elapsed += POLL_MS;
        if (elapsed >= TARGET_TIMEOUT_MS) {
          console.warn(`[tour] target "${targetId}" not found on ${pathname} -- skipping.`);
          if (stepIndex < TOUR_STEPS.length - 1) setStepIndex(stepIndex + 1);
          else finish();
          return;
        }
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }
    poll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      detachLiveTracking?.();
    };
  }, [phase, step, stepIndex, pathname, router, finish, setStepIndex]);

  // When the *next* step is one the user has to unlock (the Quick Trade modal
  // opening, say), watch for its target and move on the instant it appears --
  // so clicking the highlighted button carries the tour into the thing it
  // just opened instead of leaving the spotlight stranded behind it.
  useEffect(() => {
    if (phase !== "touring" || !nextStep?.awaitAction) return;
    if (!matchesPath(nextStep, pathname)) return;

    const targetId = nextStep.targetId;
    const timer = setInterval(() => {
      if (measure(targetId)) setStepIndex(stepIndex + 1);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, nextStep, stepIndex, pathname, setStepIndex]);

  useEffect(() => {
    if (phase !== "touring") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, finish]);

  if (phase === "welcome") {
    return <WelcomeModal onAccept={startTouring} onDecline={finish} />;
  }

  const rect = spotlight && step && spotlight.targetId === step.targetId ? spotlight.rect : null;
  if (phase !== "touring" || !step || !rect) return null;

  const padding = 6;
  // A plain ring on the target over a dim sheet that never moves. The old
  // version cut a hole in the dim with a 9999px box-shadow spread, so the
  // whole darkened screen was one element pinned to the target -- every
  // scroll re-laid-out and repainted it, which is where the banding and the
  // drift came from. Nothing here is bigger than the target itself.
  const ringStyle: React.CSSProperties = {
    position: "fixed",
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
    borderRadius: 10,
    pointerEvents: "none",
    zIndex: 101,
  };

  // Flip above the target when there isn't room below it. Anchoring by
  // `bottom` rather than `top` means this needs no knowledge of the
  // tooltip's rendered height. Without this a target low on the page (the
  // add-strategy / add-field buttons sit at the bottom of their forms) put
  // the Next button below the fold, where it couldn't be scrolled to --
  // fixed positioning doesn't scroll -- stranding the user mid-tour.
  const gap = padding + 10;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  // Below Tailwind's `sm`. On a phone there is no useful free space beside
  // or below a target -- the old floating card ended up squeezed against an
  // edge or overlapping the very control it was pointing at -- so the step
  // becomes a sheet across the bottom of the screen instead.
  const isPhone = viewportW < 640;
  // Clamped to the viewport: a target taller than the screen (or scrolled
  // partly off it) yields an anchor outside the viewport, and since the
  // tooltip is position:fixed it could not be scrolled back into view.
  const targetTop = Math.max(rect.top, 0);
  const targetBottom = Math.min(rect.top + rect.height, viewportH);
  const spaceBelow = viewportH - targetBottom;
  const spaceAbove = targetTop;
  const placeAbove = spaceBelow < TOOLTIP_SPACE_NEEDED && spaceAbove > spaceBelow;
  // Prefer sitting beside the target when there's room. Below is the obvious
  // default but it lands on top of whatever follows the target -- for a
  // field inside the Quick Trade dialog that's the next fields down, which
  // are exactly what the step is telling the user to fill in.
  const spaceRight = viewportW - (rect.left + rect.width);
  const placeBeside = !isPhone && spaceRight >= 320 + gap + 16;
  const besideAnchorsBottom = rect.top + rect.height / 2 > viewportH / 2;
  const tooltipPosition: React.CSSProperties = isPhone
    ? { left: 12, right: 12, bottom: 12 }
    : placeBeside
    ? {
        left: rect.left + rect.width + gap,
        width: 320,
        // Grows downward from a high target and upward from a low one.
        // Always anchoring the top meant a target near the bottom of the
        // screen (the add-field button sits under its form) pushed the
        // card's lower half off the viewport.
        ...(besideAnchorsBottom
          ? { bottom: Math.max(viewportH - (rect.top + rect.height) - padding, 16) }
          : { top: Math.max(rect.top - padding, 16) }),
      }
    : {
        left: Math.min(Math.max(rect.left - padding, 16), viewportW - 320 - 16),
        width: 320,
        ...(placeAbove
          ? { bottom: Math.min(Math.max(viewportH - targetTop + gap, 16), viewportH - MIN_TOOLTIP_VISIBLE) }
          : { top: Math.min(Math.max(targetBottom + gap, 16), viewportH - MIN_TOOLTIP_VISIBLE) }),
      };
  // Whatever room is left on the chosen side; the tooltip scrolls internally
  // rather than overflowing when a short viewport can't fit it.
  const tooltipMaxHeight = isPhone
    ? Math.round(viewportH * 0.45)
    : placeBeside
    ? viewportH -
      (besideAnchorsBottom
        ? Math.max(viewportH - (rect.top + rect.height) - padding, 16)
        : Math.max(rect.top - padding, 16)) -
      16
    : Math.max((placeAbove ? spaceAbove : spaceBelow) - gap - 16, MIN_TOOLTIP_VISIBLE);

  return (
    <AnimatePresence>
      <motion.div
        key="dim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        // Below the app's modals (z-50) on purpose: when the tour is
        // highlighting a field inside the Quick Trade dialog, that dialog
        // should stay bright and readable -- it already dims the page behind
        // itself. On an ordinary page nothing outranks this, so the dim
        // covers everything including the nav bar.
        style={{ position: "fixed", inset: 0, zIndex: 45, pointerEvents: "none" }}
        className="bg-black/45"
      />
      <motion.div
        key="ring"
        style={ringStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="border-2 border-primary bg-white/5 shadow-[0_0_0_3px_rgba(10,155,255,0.25)]"
      />
      <motion.div
        key={`tooltip-${stepIndex}`}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2 }}
        style={{
          position: "fixed",
          ...tooltipPosition,
          zIndex: 102,
          maxHeight: tooltipMaxHeight,
          overflowY: "auto",
        }}
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
                onClick={() => setStepIndex(stepIndex - 1)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-200"
              >
                Back
              </button>
            )}
            {/* When the next step needs the user to act, advancing happens on
                its own the moment they do -- so this is an escape hatch for
                anyone who'd rather not, not the main way forward. */}
            <button
              onClick={() => {
                const target = nextStep?.awaitAction ? indexAfterSkipping(stepIndex) : stepIndex + 1;
                if (target < TOUR_STEPS.length) setStepIndex(target);
                else finish();
              }}
              className={
                nextStep?.awaitAction
                  ? "rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                  : "rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:brightness-110 dark:text-zinc-950"
              }
            >
              {stepIndex >= TOUR_STEPS.length - 1 ? "Finish" : nextStep?.awaitAction ? "Skip" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
