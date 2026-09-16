"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { TOURS, isTourName, stepMatchesPath, type TourName, type TourStep } from "@/lib/tour/steps";
import { WelcomeModal } from "./welcome-modal";

// The guided tour.
//
// **Nothing the user does ends it.** The previous version treated any page
// change it had not requested as the user bailing out, and called finish() --
// which also marked the tour complete for good. Creating the trade from the
// wrong step of the modal, pressing `n`, using the screenshot importer,
// clicking anything that navigated: all of them killed the tour. Now a route
// change is a signal: if the step we are on lives here, stay; if a later step
// lives here, jump to it; otherwise fold into a "paused" pill with a Resume
// button. finish() runs only from Skip tour, Finish, or declining the welcome.
//
// **Task steps stay visible.** A step with `done` waits for the user to do
// something -- open Quick Trade, create the trade -- and says so on the card,
// instead of rendering nothing until the target appears.
//
// **Progress is saved.** A reload resumes the step you were on.

const REPLAY_EVENT = "trading-lens:replay-tour";
const STORAGE_KEY = "tl-tour";
// Set once the paid tour has been offered, so an upgrade prompts exactly once
// per browser rather than on every load.
const PAID_OFFERED_KEY = "tl-paid-tour-offered";

// Replaying (nav-bar "?" menu) skips the welcome screen -- that is only for a
// genuine first login. The tour name travels on the event so there is no
// ordering dependency between dispatching it and the overlay reading it.
export function startTour(tour: TourName = "basics") {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: tour }));
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

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

// The app's own dialogs (Quick Trade, screenshot import). While one is open
// it owns Escape and the backdrop, and the card has to sit above it.
function dialogIsOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

type Phase = "idle" | "welcome" | "paid-offer" | "touring";

interface Saved {
  tour: TourName;
  step: number;
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!isTourName(parsed.tour) || typeof parsed.step !== "number") return null;
    return { tour: parsed.tour, step: parsed.step };
  } catch {
    return null;
  }
}

// How long a task step's target may be gone before we decide the form was
// closed rather than submitted. Creating a trade closes the modal first and
// lands on the trade page a moment later; if that moment runs past this, the
// route change still carries the tour forward to the trade-page step, so the
// only cost of guessing wrong is a brief flash of the previous card.
const RETREAT_MS = 1500;
// How long an ordinary step's target may be missing before the card says so.
const MISSING_MS = 2000;
// A navigation the tour started that has not landed yet. Cleared on arrival
// or after this long, so a failed push cannot leave the tour waiting forever.
const PENDING_NAV_MS = 8000;

const CARD_W = 340;
const CARD_H = 230; // an estimate, used only to pick a side
const GAP = 16;
const PAD = 8; // spotlight padding around the target

const spring = { type: "spring", stiffness: 320, damping: 32 } as const;

export function TourOverlay() {
  const pathname = usePathname();
  const router = useRouter();

  const [tour, setTour] = useState<TourName>("basics");
  const steps = TOURS[tour];
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const step: TourStep | undefined = steps[stepIndex];

  const [rect, setRect] = useState<Rect | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [missing, setMissing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const checkedRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const pendingPathRef = useRef<string | null>(null);
  const rectRef = useRef<Rect | null>(null);

  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const navigateTo = useCallback(
    (path: string) => {
      if (path === pathnameRef.current) return;
      pendingPathRef.current = path;
      router.push(path);
      setTimeout(() => {
        if (pendingPathRef.current === path) pendingPathRef.current = null;
      }, PENDING_NAV_MS);
    },
    [router],
  );

  const finish = useCallback(() => {
    setPhase("idle");
    setOffRoute(false);
    setMissing(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    fetch("/api/settings/tour", { method: "PATCH" }).catch(() => {});
  }, []);

  // The next step that can actually be shown from here: one the tour can
  // navigate to, one that lives on this route, or a route-less one whose
  // target is on screen. Steps that only exist inside a closed modal, or on a
  // trade page we are not on, are passed over.
  const goForward = useCallback(
    (from: number) => {
      const here = pathnameRef.current;
      for (let j = from + 1; j < steps.length; j++) {
        const s = steps[j];
        if (s.path) {
          setStepIndex(j);
          navigateTo(s.path);
          return;
        }
        if (s.pathPrefix) {
          if (here.startsWith(s.pathPrefix)) {
            setStepIndex(j);
            return;
          }
          continue;
        }
        if (measure(s.targetId)) {
          setStepIndex(j);
          return;
        }
      }
      finish();
    },
    [steps, navigateTo, finish],
  );

  const goBack = useCallback(
    (from: number) => {
      const here = pathnameRef.current;
      for (let j = from - 1; j >= 0; j--) {
        const s = steps[j];
        if (s.path) {
          setStepIndex(j);
          navigateTo(s.path);
          return;
        }
        if (s.pathPrefix) {
          if (here.startsWith(s.pathPrefix)) {
            setStepIndex(j);
            return;
          }
          continue;
        }
        if (measure(s.targetId)) {
          setStepIndex(j);
          return;
        }
      }
    },
    [steps, navigateTo],
  );

  const begin = useCallback(
    (which: TourName) => {
      const first = TOURS[which][0];
      setTour(which);
      setStepIndex(0);
      setOffRoute(false);
      setMissing(false);
      setPhase("touring");
      if (first.path) navigateTo(first.path);
    },
    [navigateTo],
  );

  // Resume from the paused pill: the current step if the tour can navigate
  // to it, otherwise the next one it can.
  const resume = useCallback(() => {
    for (let j = stepIndex; j < steps.length; j++) {
      if (steps[j].path) {
        setStepIndex(j);
        setOffRoute(false);
        navigateTo(steps[j].path!);
        return;
      }
    }
    finish();
  }, [stepIndex, steps, navigateTo, finish]);

  // Replay requests from the "?" menu.
  useEffect(() => {
    const onReplay = (e: Event) => {
      const requested = (e as CustomEvent<unknown>).detail;
      begin(isTourName(requested) ? requested : "basics");
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [begin]);

  // First login: offer the welcome screen once, unless a tour is mid-way and
  // should simply pick up where it left off.
  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname) || checkedRef.current) return;
    checkedRef.current = true;
    const saved = readSaved();
    if (saved && saved.step < TOURS[saved.tour].length) {
      // Deferred: the resume is a state change from stored data, not from a
      // React event, and the compiler's lint wants it out of the effect body.
      // Deliberately not cleared on cleanup: this effect is guarded to run
      // once, and Strict Mode's mount-unmount-mount would cancel the timer
      // and then skip the re-run, leaving the tour never resumed.
      setTimeout(() => {
        setTour(saved.tour);
        setStepIndex(saved.step);
        setPhase("touring");
      }, 0);
      return;
    }
    fetch("/api/settings/tour")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasCompletedTour: boolean; isPaid: boolean } | null) => {
        if (!data) return;
        if (!data.hasCompletedTour) {
          setPhase("welcome");
          return;
        }
        // An account that has become paid gets the paid tour offered once.
        let offered = false;
        try {
          offered = localStorage.getItem(PAID_OFFERED_KEY) === "1";
        } catch {}
        if (data.isPaid && !offered) setPhase("paid-offer");
      })
      .catch(() => {});
  }, [pathname]);

  // Save progress on every change.
  useEffect(() => {
    if (phase !== "touring") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tour, step: stepIndex } satisfies Saved));
    } catch {}
  }, [phase, tour, stepIndex]);

  // Route changes: a signal, never an exit. Decided on the next tick so the
  // state changes are not made synchronously inside the effect.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (pendingPathRef.current) {
      if (pathname !== pendingPathRef.current) return; // still in flight
      pendingPathRef.current = null;
    }
    if (phase !== "touring" || !step) return;

    const id = setTimeout(() => {
      if (step.done && "route" in step.done && pathname.startsWith(step.done.route)) {
        goForward(stepIndex);
        return;
      }
      if (stepMatchesPath(step, pathname)) {
        setOffRoute(false);
        return;
      }
      for (let j = stepIndex + 1; j < steps.length; j++) {
        const c = steps[j];
        if ((c.path && c.path === pathname) || (c.pathPrefix && pathname.startsWith(c.pathPrefix))) {
          setStepIndex(j);
          setOffRoute(false);
          return;
        }
      }
      setOffRoute(true);
    }, 0);
    return () => clearTimeout(id);
  }, [pathname, phase, step, stepIndex, steps, goForward]);

  // Track the target every frame: position, presence, the app's dialogs, and
  // the two conditions that move a step on its own (a task completing, a
  // closed form retreating).
  useEffect(() => {
    if (phase !== "touring" || !step || offRoute) {
      rectRef.current = null;
      const clear = requestAnimationFrame(() => {
        setRect(null);
        setMissing(false);
      });
      return () => cancelAnimationFrame(clear);
    }
    let raf = 0;
    let cancelled = false;
    let missingSince: number | null = null;
    let scrolled = false;

    const tick = () => {
      if (cancelled) return;
      const dlg = dialogIsOpen();
      setDialogOpen((prev) => (prev === dlg ? prev : dlg));

      const m = measure(step.targetId);
      if (m) {
        missingSince = null;
        setMissing(false);
        if (!scrolled) {
          scrolled = true;
          const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
          const out = m.top < 80 || m.top + m.height > window.innerHeight - 80;
          if (el && out) el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        if (!sameRect(rectRef.current, m)) {
          rectRef.current = m;
          setRect(m);
        }
        if (step.done && "target" in step.done && measure(step.done.target)) {
          goForward(stepIndex);
          return;
        }
      } else {
        missingSince ??= performance.now();
        const gone = performance.now() - missingSince;
        if (rectRef.current) {
          rectRef.current = null;
          setRect(null);
        }
        if (step.retreat && gone > RETREAT_MS && !pendingPathRef.current) {
          goBack(stepIndex);
          return;
        }
        if (!step.retreat && !step.action && gone > MISSING_MS) setMissing(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, step, stepIndex, offRoute, goForward, goBack]);

  // Keys: Escape ends the tour only when no dialog is open (the dialog's own
  // Escape closes it); arrows step, from anywhere -- including inside a focus
  // trap that keeps the card's buttons out of reach.
  useEffect(() => {
    if (phase !== "touring") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dialogIsOpen()) return;
        finish();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (stepIndex >= steps.length - 1) finish();
        else goForward(stepIndex);
      } else if (e.key === "ArrowLeft" && stepIndex > 0) {
        e.preventDefault();
        goBack(stepIndex);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, stepIndex, steps.length, finish, goForward, goBack]);

  if (phase === "welcome") {
    return <WelcomeModal stepCount={TOURS.basics.length} onAccept={() => begin("basics")} onDecline={finish} />;
  }
  if (phase === "paid-offer") {
    const dismiss = () => {
      try {
        localStorage.setItem(PAID_OFFERED_KEY, "1");
      } catch {}
      setPhase("idle");
    };
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        role="region"
        aria-label="Paid plan tour offer"
        className="fixed bottom-5 left-1/2 z-[102] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border border-primary/40 bg-white/95 p-4 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] backdrop-blur-md dark:bg-card/95"
      >
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Paid plan</p>
          <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Everything just unlocked</p>
          <p className="text-xs text-zinc-500">
            A {TOURS.paid.length}-step tour of the paid features, about two minutes.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Later
        </button>
        <button
          onClick={() => {
            dismiss();
            begin("paid");
          }}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-white hover:brightness-110 dark:text-zinc-950"
        >
          Show me
        </button>
      </motion.div>
    );
  }
  if (phase !== "touring" || !step) return null;

  const isLast = stepIndex >= steps.length - 1;
  const phone = viewport.w > 0 && viewport.w < 640;

  // ---- Paused: the user is somewhere the tour has nothing to show ----------
  if (offRoute) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-5 left-1/2 z-[102] flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur-md dark:border-subtle dark:bg-card/95"
      >
        <span className="text-xs text-zinc-500">
          Tour paused · step {stepIndex + 1} of {steps.length}
        </span>
        <button
          onClick={resume}
          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:brightness-110 dark:text-zinc-950"
        >
          Resume
        </button>
        <button
          onClick={finish}
          aria-label="End tour"
          className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    );
  }

  // ---- Card placement ------------------------------------------------------
  let placement: "right" | "below" | "above" | "float" = "float";
  let cardTop = 0;
  let cardLeft = 0;
  if (rect && !phone) {
    const spaceRight = viewport.w - (rect.left + rect.width);
    const spaceBelow = viewport.h - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if (spaceRight >= CARD_W + GAP * 2) {
      placement = "right";
      cardLeft = rect.left + rect.width + GAP;
      cardTop = Math.min(Math.max(GAP, rect.top - 12), viewport.h - CARD_H - GAP);
    } else if (spaceBelow >= CARD_H + GAP || spaceBelow >= spaceAbove) {
      placement = "below";
      cardTop = rect.top + rect.height + GAP;
      cardLeft = Math.min(Math.max(GAP, rect.left), viewport.w - CARD_W - GAP);
    } else {
      placement = "above";
      cardTop = Math.max(GAP, rect.top - GAP - CARD_H);
      cardLeft = Math.min(Math.max(GAP, rect.left), viewport.w - CARD_W - GAP);
    }
  }

  const cardStyle: React.CSSProperties = phone
    ? { position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 102 }
    : placement === "float"
      ? { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", width: CARD_W, zIndex: 102 }
      : { position: "fixed", width: CARD_W, zIndex: 102 };

  const primaryLabel = isLast ? "Finish" : step.action ? "I'll do this later" : "Next";

  return (
    <>
      {/* Dim with a cutout, so the target is the brightest thing on screen.
          Hidden while one of the app's dialogs is open: it brings its own
          backdrop, and two dims read as a bug. */}
      <AnimatePresence>
        {rect && !dialogOpen && (
          <motion.svg
            key="dim"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none fixed inset-0 z-[45] h-full w-full"
          >
            <defs>
              <mask id="tl-tour-mask">
                <rect width="100%" height="100%" fill="#fff" />
                <motion.rect
                  rx="12"
                  fill="#000"
                  animate={{ x: rect.left - PAD, y: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
                  transition={spring}
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tl-tour-mask)" />
          </motion.svg>
        )}
      </AnimatePresence>

      {/* The ring, gliding between targets. */}
      <AnimatePresence>
        {rect && (
          <motion.div
            key="ring"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
            exit={{ opacity: 0 }}
            transition={{ ...spring, opacity: { duration: 0.2 } }}
            style={{ position: "fixed", zIndex: 101, pointerEvents: "none" }}
            className="rounded-xl border-2 border-primary"
          >
            <div className="absolute inset-0 animate-pulse rounded-xl shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-primary)_22%,transparent)]" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The card. */}
      <motion.div
        role="region"
        aria-label="Guided tour"
        style={cardStyle}
        animate={placement === "float" || phone ? undefined : { top: cardTop, left: cardLeft }}
        transition={spring}
        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] dark:border-subtle dark:bg-card"
      >
        {placement !== "float" && !phone && (
          <span
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 border-zinc-200 bg-white dark:border-subtle dark:bg-card ${
              placement === "right"
                ? "-left-[7px] top-6 border-b border-l"
                : placement === "below"
                  ? "-top-[7px] left-6 border-l border-t"
                  : "-bottom-[7px] left-6 border-b border-r"
            }`}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${tour}-${stepIndex}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                Step {stepIndex + 1} of {steps.length} · {step.where}
              </p>
              <button
                onClick={finish}
                aria-label="Skip tour"
                className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>

            {step.action && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">Your turn</span>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{step.action}</span>
              </div>
            )}
            {missing && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Can&rsquo;t find this on the page right now.</p>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.targetId + i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === stepIndex ? "w-4 bg-primary" : i < stepIndex ? "w-1.5 bg-primary/40" : "w-1.5 bg-zinc-300 dark:bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {stepIndex > 0 && (
              <button
                onClick={() => goBack(stepIndex)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : goForward(stepIndex))}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium ${
                step.action && !isLast
                  ? "border border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
                  : "bg-primary text-white hover:brightness-110 dark:text-zinc-950"
              }`}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
