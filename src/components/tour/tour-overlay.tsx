"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { PUBLIC_PATHS } from "@/lib/public-paths";
import { useAnalytics } from "@/lib/tracking/useAnalytics";
import { SNOOZE_DAYS, shouldShowPaidOffer, snoozeUntil } from "@/lib/tour/paid-offer";
import { TOURS, isTourName, stepMatchesPath, type PhoneOpener, type TourName, type TourStep } from "@/lib/tour/steps";
import { PHONE_EDGE, phoneDock, phoneScrollDelta } from "@/lib/tour/phone-placement";
import { navDirections, type NavDirections } from "@/lib/tour/nav-target";
import { nextStep, openerOf, placeStep, prevStep, resumeStep, type EngineContext } from "@/lib/tour/engine";
import { QUICK_TRADE_CLOSED_EVENT, QUICK_TRADE_OPENED_EVENT, TRADE_CREATED_EVENT, signalCloseSheets } from "@/lib/tour/signals";
import { WelcomeModal } from "./welcome-modal";
import { usePreferences } from "@/components/preferences/preferences-provider";
import { DemoOfferModal } from "@/components/demo/demo-offer-modal";

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
//
// **It never changes the page, and never guesses** (2026-10-07). Next, Back,
// Resume and starting a tour all point the way -- the menu item, or a link
// to the trade it created -- and the user clicks. Tasks finish on a signal
// from the form (src/lib/tour/signals.ts), not on a timer. Which step comes
// next is decided by src/lib/tour/engine.ts, which is tested on its own.

const REPLAY_EVENT = "trading-lens:replay-tour";
const STORAGE_KEY = "tl-tour";

// The paid-offer fallback, used only until migration 0049 is applied -- after
// that the answer lives on user_settings and follows the account between
// browsers. Shaped like the database columns so the two paths read the same.
// Replaces `tl-paid-tour-offered`, which was a single "shown once ever" bit
// and could not tell "Later" from "no thanks" (issue 2 of
// docs/design-audit.md).
const PAID_OFFER_KEY = "tl-paid-tour-offer";
// Session-scoped, so one page load offers it at most once even when nothing
// has been answered yet.
const PAID_OFFER_SESSION_KEY = "tl-paid-tour-offer-seen";

interface TourSettings {
  hasCompletedTour: boolean;
  /** Phase 4D: ask "Start with a demo journal?" before the welcome. */
  offerDemo?: boolean;
  isPaid: boolean;
  paidTourDismissed: boolean | null;
  paidTourSnoozedUntil: string | null;
  /** False when migration 0049 has not been applied, which is the signal to
   *  trust this browser's copy instead of the two fields above. */
  paidTourStateStored: boolean;
}

interface StoredPaidOffer {
  dismissed: boolean;
  snoozedUntil: string | null;
}

// The key this replaced. It was one bit, set by EITHER "Later" or "Show me",
// so it cannot say which. Read as dismissed: someone who answered the old
// card has already answered, and missing one offer costs less than showing a
// card again to a person who said no to it.
const LEGACY_PAID_OFFERED_KEY = "tl-paid-tour-offered";

function readLocalPaidOffer(): StoredPaidOffer {
  try {
    const raw = localStorage.getItem(PAID_OFFER_KEY);
    if (!raw) {
      return { dismissed: localStorage.getItem(LEGACY_PAID_OFFERED_KEY) === "1", snoozedUntil: null };
    }
    const parsed = JSON.parse(raw) as Partial<StoredPaidOffer>;
    return {
      dismissed: parsed.dismissed === true,
      snoozedUntil: typeof parsed.snoozedUntil === "string" ? parsed.snoozedUntil : null,
    };
  } catch {
    return { dismissed: false, snoozedUntil: null };
  }
}

function writeLocalPaidOffer(next: StoredPaidOffer) {
  try {
    localStorage.setItem(PAID_OFFER_KEY, JSON.stringify(next));
  } catch {}
}

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

// The first target with a box, not simply the first in the document.
//
// The nav renders some items twice -- the help menu sits in the bar above
// 1000px and inside the account menu below it, both carrying
// data-tour-id="nav-help" -- and only one of the pair is displayed at a time.
// A plain querySelector would find whichever came first in the markup, get a
// 0x0 rect for it when it is the hidden one, and spotlight the top-left
// corner of the page.
function findTarget(targetId: string): Element | null {
  const all = document.querySelectorAll(`[data-tour-id="${targetId}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return all[0] ?? null;
}

// A target with no box (display:none -- the Trades page's header buttons on
// a phone) is not there. It used to measure as 0x0 and put the spotlight in
// the top-left corner of the screen.
function measure(targetId: string): Rect | null {
  const el = findTarget(targetId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Below `sm`, where the tab bar replaces the top menu. */
function isPhone(): boolean {
  return window.innerWidth < 640;
}

/** What the tab bar's sheet openers are called on screen. */
const OPENER_LABEL: Record<PhoneOpener, string> = { "nav-add": "+", "nav-more": "More" };

/**
 * On a phone, bring the target where the card is not (phone-placement.ts),
 * instead of to the middle of the screen, where the card covered its lower
 * half. Things that don't scroll with the page are left alone.
 */
function scrollIntoPhoneView(el: Element, cardH: number) {
  if (el.closest('[role="dialog"]')) {
    el.scrollIntoView({ block: "nearest" });
    return;
  }
  if (el.closest("header, [data-mobile-tabbar]")) return;
  const r = el.getBoundingClientRect();
  const delta = phoneScrollDelta(
    { top: r.top, height: r.height },
    {
      viewportH: window.innerHeight,
      tabBarH: document.querySelector("[data-mobile-tabbar]")?.getBoundingClientRect().height ?? 0,
      cardH,
      headerH: document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
    },
  );
  if (delta !== 0) window.scrollBy({ top: delta, behavior: "smooth" });
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

type Phase = "idle" | "demo-offer" | "welcome" | "paid-offer" | "touring";

interface Saved {
  tour: TourName;
  step: number;
  /** Task steps already done, so Back and Resume never ask for them again. */
  done?: number[];
  /** The trade created during the tour; its page's steps link to it. */
  tradePath?: string | null;
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!isTourName(parsed.tour) || typeof parsed.step !== "number") return null;
    // Older saves have neither field; both default to "nothing done yet".
    const done = Array.isArray(parsed.done) ? parsed.done.filter((n): n is number => typeof n === "number") : [];
    const tradePath = typeof parsed.tradePath === "string" && parsed.tradePath.startsWith("/trades/") ? parsed.tradePath : null;
    return { tour: parsed.tour, step: parsed.step, done, tradePath };
  } catch {
    return null;
  }
}

// How long an ordinary step's target may be missing before the card says so.
// Counted only while the page is actually there -- see pageStillLoading().
const MISSING_MS = 2000;

/**
 * Is the page still loading, as opposed to loaded and missing the target?
 *
 * "Can't find this on the page right now" used to flash for a second on
 * ordinary steps and then clear, because the 2s clock above ran through two
 * windows where the target cannot exist yet:
 *
 *  - a route loading skeleton (a loading.tsx). The URL has already switched
 *    and the tour thinks it has arrived, but the skeleton has no targets; they
 *    appear when the real page streams in. /analytics gained one in Phase 1B
 *    of docs/design-audit.md, which made this more likely there.
 *
 * Every loading.tsx marks its root with data-route-loading for this. A new
 * one that forgets will bring the flash back on its route, and nothing else.
 */
function pageStillLoading(): boolean {
  return document.querySelector("[data-route-loading]") !== null;
}

/** On screen with a box -- a hidden duplicate (see findTarget) doesn't count. */
function isShown(targetId: string): boolean {
  const m = measure(targetId);
  return !!m && m.width > 0 && m.height > 0;
}

const CARD_W = 340;
const CARD_H = 230; // an estimate, used only to pick a side
const GAP = 16;
const PAD = 8; // spotlight padding around the target

// The spotlight, ring and card glide between targets in 0.2s. A spring took
// about half a second to settle, which read as lag (2026-09-29 follow-up).
const GLIDE = { type: "tween", ease: "easeOut", duration: 0.2 } as const;
const NO_GLIDE = { duration: 0 } as const;

export function TourOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  // Setup -> Settings "Tour offers": off hides the paid-tour nudge card. A
  // tour the user starts themselves (help menu) is unaffected.
  const { prefs } = usePreferences();

  const [tour, setTour] = useState<TourName>("basics");
  const steps = TOURS[tour];
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const step: TourStep | undefined = steps[stepIndex];

  const [rect, setRect] = useState<Rect | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  // The next stop is on another page, and the tour is waiting for the user to
  // go there through the menu (Alon, 2026-09-29: the tour used to move them
  // itself, so fast they couldn't follow where they were). `navInfo` says what
  // to point at and how to word it; see src/lib/tour/nav-target.ts.
  const [navPending, setNavPending] = useState(false);
  const [navInfo, setNavInfo] = useState<NavDirections | null>(null);
  // The user has clicked the menu item and the page is on its way: the card
  // says "Opening…" straight away rather than repeating "Click …".
  const [navClicked, setNavClicked] = useState(false);
  // Pointing the way back rather than forward: the card says "Back: …".
  const [goingBack, setGoingBack] = useState(false);
  // Task steps done in this run, and the trade the tour created.
  const [doneTasks, setDoneTasks] = useState<number[]>([]);
  const [tradePath, setTradePath] = useState<string | null>(null);
  // Quick trade said "created": its page is on its way, however long it takes.
  const [awaitingTrade, setAwaitingTrade] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const glide = reduceMotion ? NO_GLIDE : GLIDE;
  const [missing, setMissing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0, tabBar: 0 });
  // Phones: the step's target lives in a tab bar sheet that isn't open, and
  // the spotlight is on the button that opens it (TourStep.phoneVia).
  const [viaOpener, setViaOpener] = useState(false);
  // The card's real height, which decides which end of a phone it goes to.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  const cardHRef = useRef(0);

  const checkedRef = useRef(false);
  const pathnameRef = useRef(pathname);
  const rectRef = useRef<Rect | null>(null);
  // A target that must disappear before it counts as "shown" again. Set when
  // Quick trade signals it was closed: the form fades out for a moment, and
  // its still-visible field would otherwise complete "Click Quick trade" in
  // the next frame and jump straight back into the closed form's step.
  const leavingRef = useRef<string | null>(null);

  // What the engine needs to know about right now.
  const engineContext = useCallback(
    (): EngineContext => ({
      pathname: pathnameRef.current,
      isShown,
      doneTasks: new Set(doneTasks),
      tradePath,
    }),
    [doneTasks, tradePath],
  );

  useEffect(() => {
    const read = () =>
      setViewport({
        w: window.innerWidth,
        h: window.innerHeight,
        tabBar: document.querySelector("[data-mobile-tabbar]")?.getBoundingClientRect().height ?? 0,
      });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // One analytics event per tour instead of a click-by-click trail (Alon,
  // 2026-09-29): while the tour or its questions are on screen, <html> carries
  // data-tour="active" and click capture and page views stand down (see
  // isTourActive in lib/tracking/click-capture.ts). Not while paused -- the
  // user has wandered off to do their own thing -- and not for the paid-tour
  // offer, a corner card the user works around rather than a tour: flagging
  // it muted all their ordinary use while it sat there.
  const { track } = useAnalytics();
  useEffect(() => {
    const root = document.documentElement;
    const inTour = phase === "demo-offer" || phase === "welcome" || phase === "touring";
    if (inTour && !offRoute) root.dataset.tour = "active";
    else delete root.dataset.tour;
    return () => {
      delete root.dataset.tour;
    };
  }, [phase, offRoute]);

  const finish = useCallback((outcome: "completed" | "skipped") => {
    if (phase === "touring" || phase === "welcome") {
      track(outcome === "completed" ? "tour_completed" : "tour_skipped", {
        tour,
        ...(outcome === "completed" ? { steps: steps.length } : { atStep: phase === "welcome" ? 0 : stepIndex + 1 }),
      });
    }
    setPhase("idle");
    setOffRoute(false);
    setMissing(false);
    setAwaitingTrade(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    fetch("/api/settings/tour", { method: "PATCH" }).catch(() => {});
  }, [phase, tour, steps.length, stepIndex, track]);

  // Show a step: on this page, or pointing the way to it ("go"). Never a
  // navigation -- see the header.
  const show = useCallback((index: number, mode: "here" | "go", back = false) => {
    setStepIndex(index);
    setNavPending(mode === "go");
    setGoingBack(back && mode === "go");
    setOffRoute(false);
  }, []);

  const markDone = useCallback((...indexes: (number | null)[]) => {
    setDoneTasks((prev) => {
      const add = indexes.filter((i): i is number => i !== null && !prev.includes(i));
      return add.length ? [...prev, ...add] : prev;
    });
  }, []);

  const goForward = useCallback(
    (from: number, ctx: EngineContext = engineContext()) => {
      const m = nextStep(steps, from, ctx);
      if (m) show(m.index, m.mode);
      else finish("completed");
    },
    [steps, engineContext, show, finish],
  );

  const goBack = useCallback(
    (from: number) => {
      const m = prevStep(steps, from, engineContext());
      if (m) show(m.index, m.mode, true);
    },
    [steps, engineContext, show],
  );

  const begin = useCallback(
    (which: TourName) => {
      setTour(which);
      setDoneTasks([]);
      setTradePath(null);
      setAwaitingTrade(null);
      setMissing(false);
      setPhase("touring");
      // From the ? menu on any page: point the way to the first stop.
      const first = placeStep(TOURS[which], 0, { pathname: pathnameRef.current, isShown, doneTasks: new Set(), tradePath: null });
      show(0, first?.mode ?? "here");
    },
    [show],
  );

  // Resume from the paused pill: this step, or the next one that can be shown.
  const resume = useCallback(() => {
    const m = resumeStep(steps, stepIndex, engineContext());
    if (m) show(m.index, m.mode);
    else finish("completed");
  }, [stepIndex, steps, engineContext, show, finish]);

  // Quick trade's signals: a trade was created (its page is on its way), or
  // the form was closed without one (back to the step that opened it).
  useEffect(() => {
    if (phase !== "touring" || !step) return;
    const onCreated = (e: Event) => {
      const path = (e as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path !== "string" || !step.done || !("route" in step.done) || !path.startsWith(step.done.route)) return;
      markDone(stepIndex, openerOf(steps, stepIndex));
      setTradePath(path);
      setAwaitingTrade(path);
    };
    const onClosed = () => {
      const opener = openerOf(steps, stepIndex);
      if (opener === null) return;
      const openerDone = steps[opener].done;
      leavingRef.current = openerDone && "target" in openerDone ? openerDone.target : null;
      setDoneTasks((prev) => prev.filter((i) => i !== opener));
      const m = placeStep(steps, opener, { ...engineContext(), doneTasks: new Set() });
      show(opener, m?.mode ?? "here", true);
    };
    // Opened again: whatever was "leaving" is back on purpose, so the open
    // form counts at once (it may never have disappeared -- reopened during
    // its closing fade, it fades straight back in).
    const onOpened = () => {
      leavingRef.current = null;
    };
    window.addEventListener(TRADE_CREATED_EVENT, onCreated);
    window.addEventListener(QUICK_TRADE_CLOSED_EVENT, onClosed);
    window.addEventListener(QUICK_TRADE_OPENED_EVENT, onOpened);
    return () => {
      window.removeEventListener(TRADE_CREATED_EVENT, onCreated);
      window.removeEventListener(QUICK_TRADE_CLOSED_EVENT, onClosed);
      window.removeEventListener(QUICK_TRADE_OPENED_EVENT, onOpened);
    };
  }, [phase, step, stepIndex, steps, engineContext, markDone, show]);

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
        setDoneTasks(saved.done ?? []);
        setTradePath(saved.tradePath ?? null);
        setPhase("touring");
      }, 0);
      return;
    }
    fetch("/api/settings/tour")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TourSettings | null) => {
        if (!data) return;
        if (!data.hasCompletedTour) {
          // The demo question comes first, so the tour runs over whichever
          // journal the user chose.
          setPhase(data.offerDemo ? "demo-offer" : "welcome");
          return;
        }

        // Server state when 0049 has been applied, this browser's copy until
        // then. `paidTourStateStored` is the switch, rather than checking the
        // fields for null -- a dismissed flag of null would otherwise read as
        // "not dismissed" and re-offer the tour on every load.
        const local = readLocalPaidOffer();
        const stored = data.paidTourStateStored === true;
        let seenThisSession = false;
        try {
          seenThisSession = sessionStorage.getItem(PAID_OFFER_SESSION_KEY) === "1";
        } catch {}

        const show = shouldShowPaidOffer({
          isPaid: data.isPaid,
          dismissed: stored ? data.paidTourDismissed === true : local.dismissed,
          snoozedUntil: stored ? (data.paidTourSnoozedUntil ?? null) : local.snoozedUntil,
          seenThisSession,
        });

        if (show) {
          try {
            sessionStorage.setItem(PAID_OFFER_SESSION_KEY, "1");
          } catch {}
          setPhase("paid-offer");
        }
      })
      .catch(() => {});
  }, [pathname]);

  // While pointing the way, load that page in the background, so the click
  // shows it (or its skeleton) almost at once. A no-op on the dev server.
  useEffect(() => {
    if (navPending && step?.path) router.prefetch(step.path);
  }, [navPending, step, router]);

  // A click on the item the tour is pointing at: the page is on its way.
  useEffect(() => {
    if (!navPending || !step?.path) return;
    const linkSelector = `[data-tour-id="nav-${step.path.slice(1)}"]`;
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(linkSelector)) setNavClicked(true);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      setNavClicked(false);
    };
  }, [navPending, step]);

  // A step that points somewhere else -- another page, or a different tab bar
  // sheet -- closes the phone's + and More sheets, which would otherwise sit
  // over the very button it asks for. Not for other steps: Quick trade opened
  // from the + sheet lives inside it, and closing it would shut the form.
  const stepPointsElsewhere = phase === "touring" && (navPending || !!step?.phoneVia);
  useEffect(() => {
    if (stepPointsElsewhere) signalCloseSheets();
  }, [stepPointsElsewhere, tour, stepIndex]);

  // Save progress on every change.
  useEffect(() => {
    if (phase !== "touring") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tour, step: stepIndex, done: doneTasks, tradePath } satisfies Saved));
    } catch {}
  }, [phase, tour, stepIndex, doneTasks, tradePath]);

  // Route changes: a signal, never an exit. Decided on the next tick so the
  // state changes are not made synchronously inside the effect.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (phase !== "touring" || !step) return;

    const id = setTimeout(() => {
      // Waiting for the user to open the next page: arriving there resumes
      // the step; anywhere else, the card keeps pointing the way.
      if (navPending) {
        if ((step.path || step.pathPrefix) && stepMatchesPath(step, pathname)) {
          // Drop the menu item's spotlight on arrival, so the step can't show
          // for a frame against it before the page's own target is measured.
          rectRef.current = null;
          setRect(null);
          setNavPending(false);
        }
        setOffRoute(false);
        return;
      }
      if (step.done && "route" in step.done && pathname.startsWith(step.done.route)) {
        // However the task was done (Quick trade, the screenshot importer...),
        // it is done: remember it, and the trade it led to.
        const done = new Set([...doneTasks, stepIndex, openerOf(steps, stepIndex) ?? stepIndex]);
        markDone(stepIndex, openerOf(steps, stepIndex));
        if (pathname.startsWith("/trades/")) setTradePath(pathname);
        setAwaitingTrade(null);
        goForward(stepIndex, { pathname, isShown, doneTasks: done, tradePath: pathname });
        return;
      }
      if (stepMatchesPath(step, pathname)) {
        setOffRoute(false);
        return;
      }
      // A later step lives on the page the user went to: carry on from it.
      for (let j = stepIndex + 1; j < steps.length; j++) {
        const c = steps[j];
        if (!c.path && !c.pathPrefix) continue;
        if (placeStep(steps, j, engineContext())?.mode === "here") {
          show(j, "here");
          return;
        }
      }
      setOffRoute(true);
    }, 0);
    return () => clearTimeout(id);
  }, [pathname, phase, step, stepIndex, steps, goForward, navPending, doneTasks, markDone, engineContext, show]);

  // Track the target every frame: position, presence, the app's dialogs, and
  // a task completing (which moves the step on by itself).
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
    let scrolledFor: string | null = null;

    const tick = () => {
      if (cancelled) return;
      const dlg = dialogIsOpen();
      setDialogOpen((prev) => (prev === dlg ? prev : dlg));

      if (navPending && step.path) {
        // Pointing the way: the menu item, or the dropdown holding it, found
        // afresh each frame so the spotlight moves to the item the moment its
        // menu opens.
        const d = navDirections(step.path, (id) => measure(id) !== null && measure(id)!.width > 0);
        setNavInfo((prev) =>
          // The label counts too: Goals and Emotions sit behind the same More
          // button (Insights and Goals behind the same Analysis menu), and
          // comparing only where it pointed kept the previous page's name.
          prev && prev.kind === d.kind && prev.targetId === d.targetId && prev.label === d.label ? prev : d,
        );
        const nm = d.targetId ? measure(d.targetId) : null;
        if (nm && d.targetId && !scrolled) {
          // A phone's menu scrolls sideways: bring the item into view once.
          scrolled = true;
          findTarget(d.targetId)?.scrollIntoView({ block: "nearest", inline: "center" });
        }
        if (!sameRect(rectRef.current, nm)) {
          rectRef.current = nm;
          setRect(nm);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (navPending || awaitingTrade) {
        // Pointing at a trade page (no menu item: the card holds the link), or
        // waiting for the created trade's page: nothing to spotlight yet.
        setNavInfo((prev) => (prev === null ? prev : null));
        if (rectRef.current) {
          rectRef.current = null;
          setRect(null);
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      // On a phone a target can live in a tab bar sheet that isn't open:
      // point at the button that opens it until it is.
      let shownId = step.targetId;
      let m = measure(shownId);
      if (!m && step.phoneVia && isPhone()) {
        const opener = measure(step.phoneVia.opener);
        if (opener) {
          shownId = step.phoneVia.opener;
          m = opener;
        }
      }
      const via = shownId !== step.targetId;
      setViaOpener((prev) => (prev === via ? prev : via));
      if (m) {
        missingSince = null;
        setMissing(false);
        // Once per thing pointed at: the opener, then the item in its sheet.
        if (scrolledFor !== shownId) {
          scrolledFor = shownId;
          const el = findTarget(shownId);
          if (el && isPhone()) {
            scrollIntoPhoneView(el, cardHRef.current || 230);
          } else if (el && (m.top < 80 || m.top + m.height > window.innerHeight - 80)) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
        if (!sameRect(rectRef.current, m)) {
          rectRef.current = m;
          setRect(m);
        }
        if (leavingRef.current && !isShown(leavingRef.current)) leavingRef.current = null;
        if (step.done && "target" in step.done && step.done.target !== leavingRef.current && isShown(step.done.target)) {
          markDone(stepIndex);
          goForward(stepIndex, { ...engineContext(), doneTasks: new Set([...doneTasks, stepIndex]) });
          return;
        }
      } else if (pageStillLoading()) {
        // Not missing, just not here yet: hold the clock at zero so it starts
        // fresh when the page lands.
        missingSince = null;
        if (rectRef.current) {
          rectRef.current = null;
          setRect(null);
        }
      } else {
        missingSince ??= performance.now();
        const gone = performance.now() - missingSince;
        if (rectRef.current) {
          rectRef.current = null;
          setRect(null);
        }
        if (!step.action && gone > MISSING_MS) setMissing(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [phase, step, stepIndex, offRoute, goForward, navPending, awaitingTrade, markDone, engineContext, doneTasks]);

  // Keys: Escape ends the tour only when no dialog is open (the dialog's own
  // Escape closes it); arrows step, from anywhere -- including inside a focus
  // trap that keeps the card's buttons out of reach.
  useEffect(() => {
    if (phase !== "touring") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dialogIsOpen()) return;
        finish("skipped");
        return;
      }
      if (isTyping(e.target)) return;
      // While pointing the way, the next step is the page the user opens.
      if (e.key === "ArrowRight" && navPending) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (stepIndex >= steps.length - 1) finish("completed");
        else goForward(stepIndex);
      } else if (e.key === "ArrowLeft" && stepIndex > 0) {
        e.preventDefault();
        goBack(stepIndex);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, stepIndex, steps.length, finish, goForward, goBack, navPending]);

  // The card's height, measured rather than guessed: it decides which end of
  // a phone the card goes to, and how much room the strip asks dialogs for.
  const cardShown = phase === "touring" && !!step && !offRoute;
  useEffect(() => {
    const el = cardRef.current;
    if (!cardShown || !el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      cardHRef.current = h;
      setCardH((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardShown]);

  // Phone + an open dialog = the card is a strip across the top. Dialogs
  // and sheets leave that much room above themselves (--tour-top in
  // globals.css), so the strip never covers the form the tour is asking
  // the user to fill in.
  const stripH = cardShown && dialogOpen && viewport.w > 0 && viewport.w < 640 ? cardH : 0;
  useEffect(() => {
    const root = document.documentElement;
    if (stripH > 0) root.style.setProperty("--tour-top", `${stripH + PHONE_EDGE * 2}px`);
    else root.style.removeProperty("--tour-top");
    return () => {
      root.style.removeProperty("--tour-top");
    };
  }, [stripH]);

  if (phase === "demo-offer") {
    return <DemoOfferModal onDone={() => setPhase("welcome")} />;
  }
  if (phase === "welcome") {
    return <WelcomeModal stepCount={TOURS.basics.length} onAccept={() => begin("basics")} onDecline={() => finish("skipped")} />;
  }
  if (phase === "paid-offer" && prefs.tourOffers) {
    // Both answers write locally first and tell the server second. The local
    // write is what makes this work before 0049 is applied, and it also means
    // a failed request cannot resurrect a card the reader has just declined.
    const answer = (kind: "dismissed" | "snoozed") => {
      const until = kind === "snoozed" ? snoozeUntil() : null;
      writeLocalPaidOffer({ dismissed: kind === "dismissed", snoozedUntil: until });
      fetch("/api/settings/tour", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidOffer: kind, until }),
      }).catch(() => {});
      setPhase("idle");
    };
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        role="region"
        aria-label="Paid plan tour offer"
        // Bottom RIGHT, and narrow. Centred, it landed across the middle of
        // whatever was on the page -- a trade table, the performance chart --
        // and stayed there until answered (issue 2 of docs/design-audit.md).
        // A corner is the one place a card this size covers nothing that is
        // being read. Not shown on phones at all: there it covered the tab
        // bar, and every tour is still one tap away in the account menu.
        className="fixed bottom-4 right-4 z-[102] hidden w-[calc(100vw-2rem)] sm:flex max-w-sm items-center gap-3 rounded-2xl border border-primary/40 bg-white/95 p-4 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] backdrop-blur-md sm:w-auto dark:bg-card/95"
      >
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Paid plan</p>
          <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Everything just unlocked</p>
          <p className="text-xs text-zinc-500">
            A {TOURS.paid.length}-step tour of the paid features, about two minutes.
          </p>
        </div>
        <button
          onClick={() => answer("snoozed")}
          title={`Hides this for ${SNOOZE_DAYS} days`}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Later
        </button>
        <button
          onClick={() => {
            answer("dismissed");
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
        className="fixed bottom-[calc(var(--tabbar-h)+1.25rem)] left-1/2 z-[102] flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur-md dark:border-subtle dark:bg-card/95"
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
          onClick={() => finish("skipped")}
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
    } else if (spaceBelow < CARD_H + GAP && spaceAbove < CARD_H + GAP) {
      // A target taller than the window (the Mistakes panel over a full
      // journal, e.g. the 4D demo's) leaves no room either side. "Below" put
      // the card off the bottom of the screen with its buttons out of reach;
      // floating it at the bottom keeps it readable over the target.
      placement = "float";
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

  // Phones: never on top of the target (src/lib/tour/phone-placement.ts).
  const dock = phone
    ? phoneDock({
        viewportH: viewport.h,
        tabBarH: viewport.tabBar,
        cardH: cardH || 230,
        target: rect,
        dialogOpen,
      })
    : null;
  const strip = dock === "strip";
  const phoneEdge = `calc(env(safe-area-inset-top) + ${PHONE_EDGE}px)`;

  const cardStyle: React.CSSProperties = phone
    ? {
        position: "fixed",
        left: PHONE_EDGE,
        right: PHONE_EDGE,
        zIndex: 102,
        // A long step on a short screen scrolls inside rather than off it.
        maxHeight: `calc(100dvh - var(--tabbar-h) - ${PHONE_EDGE * 2}px)`,
        overflowY: "auto",
        ...(dock === "bottom" ? { bottom: `calc(var(--tabbar-h) + ${PHONE_EDGE}px)` } : { top: phoneEdge }),
      }
    : placement === "float"
      ? { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", width: CARD_W, zIndex: 102 }
      : { position: "fixed", width: CARD_W, zIndex: 102 };

  const primaryLabel = isLast ? "Finish" : step.action ? "I'll do this later" : "Next";
  // "go": pointing the way to the next page. "loading": arrived, but the
  // step's target isn't on the page yet -- say so, rather than show this
  // step's text over a page that hasn't loaded (it used to, for up to half a
  // second on a production build). "step": the step itself.
  const cardMode: "go" | "loading" | "step" = awaitingTrade
    ? "loading"
    : navPending
      ? navClicked
        ? "loading"
        : "go"
      : !rect && !missing && step.path && !step.action
        ? "loading"
        : "step";
  // A trade page has no menu item: the card links to the trade instead.
  const goToTrade = navPending && !step.path && step.pathPrefix && tradePath ? tradePath : null;
  // Where to go next, in words. A phone has no menu bar: its pages are on
  // the tab bar at the bottom, or in its More sheet.
  const tap = phone ? "Tap" : "Click";
  const goInstruction = goToTrade ? (
    <>Open the trade you just created.</>
  ) : navInfo?.kind === "group" && phone && navInfo.groupLabel === "More" ? (
    <>
      Tap <b>More</b> at the bottom, then <b>{navInfo.label}</b>.
    </>
  ) : navInfo?.kind === "group" ? (
    <>
      Open <b>{navInfo.groupLabel}</b> in the menu, then click <b>{navInfo.label}</b>.
    </>
  ) : navInfo?.kind === "account" ? (
    <>
      Open the <b>account menu</b> (top right), then {tap.toLowerCase()} <b>{navInfo.label}</b>.
    </>
  ) : navInfo?.kind === "link" ? (
    <>
      {tap} <b>{navInfo.label}</b> {phone && !dialogOpen && rect && rect.top > viewport.h / 2 ? "at the bottom" : "in the menu"}.
    </>
  ) : (
    <>
      Open <b>{navInfo?.label ?? step.where}</b> from the menu to carry on.
    </>
  );
  const loadingText = awaitingTrade ? "Opening your trade…" : <>Opening {step.where}…</>;
  // Only page-bound steps decide this (no DOM reads during render): a step
  // inside the Quick trade form is never a Back target once the form is shut.
  const canGoBack =
    stepIndex > 0 &&
    prevStep(steps, stepIndex, { pathname, isShown: () => false, doneTasks: new Set(doneTasks), tradePath }) !== null;

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
                  transition={glide}
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
            transition={{ ...glide, opacity: { duration: reduceMotion ? 0 : 0.2 } }}
            style={{ position: "fixed", zIndex: 101, pointerEvents: "none" }}
            className="rounded-xl border-2 border-primary"
          >
            <div className="absolute inset-0 animate-pulse rounded-xl shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-primary)_22%,transparent)]" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The card. */}
      <motion.div
        ref={cardRef}
        role="region"
        aria-label="Guided tour"
        data-dock={dock ?? undefined}
        style={cardStyle}
        animate={placement === "float" || phone ? undefined : { top: cardTop, left: cardLeft }}
        transition={glide}
        className={`rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] dark:border-subtle dark:bg-card ${
          strip ? "flex items-end gap-3 px-4 py-3" : phone ? "p-4" : "p-5"
        }`}
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

        {/* No fade-out: the old step used to fade for 180ms before the new
            one appeared, on top of the page change -- part of what read as
            lag. The new content simply settles in. */}
        <motion.div
          key={`${tour}-${stepIndex}-${cardMode}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className={strip ? "min-w-0 flex-1" : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
              Step {stepIndex + 1} of {steps.length} · {step.where}
            </p>
            <button
              onClick={() => finish("skipped")}
              aria-label="Skip tour"
              className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {strip ? (
            // Phone, over an open dialog or sheet: what to do, in one line,
            // and the dialog keeps the rest of the screen.
            <p className="mt-1 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-100" role="status">
              {cardMode === "go" ? goInstruction : cardMode === "loading" ? loadingText : (step.action ?? step.title)}
            </p>
          ) : cardMode === "go" ? (
            <>
              <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                {goingBack ? "Back" : "Next"}: {step.where}
              </h3>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">Your turn</span>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{goInstruction}</span>
              </div>
            </>
          ) : cardMode === "loading" ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400" role="status">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-primary" aria-hidden />
              {loadingText}
            </p>
          ) : (
            <>
              <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>

              {(step.action || (viaOpener && step.phoneVia)) && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">Your turn</span>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {viaOpener && step.phoneVia ? (
                      <>
                        Tap <b>{OPENER_LABEL[step.phoneVia.opener]}</b> at the bottom, then <b>{step.phoneVia.item}</b>.
                      </>
                    ) : (
                      step.action
                    )}
                  </span>
                </div>
              )}
              {missing && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Can&rsquo;t find this on the page right now.</p>
              )}
            </>
          )}
        </motion.div>

        <div className={strip ? "flex shrink-0 items-center gap-1.5" : "mt-4 flex items-center justify-between gap-3"}>
          <div className="flex items-center gap-1" aria-hidden>
            {!strip &&
              steps.map((s, i) => (
                <span
                  key={s.targetId + i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === stepIndex ? "w-4 bg-primary" : i < stepIndex ? "w-1.5 bg-primary/40" : "w-1.5 bg-zinc-300 dark:bg-zinc-700"
                  }`}
                />
              ))}
          </div>
          <div className="flex items-center gap-1.5">
            {canGoBack && !strip && (
              <button
                onClick={() => goBack(stepIndex)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Back
              </button>
            )}
            {cardMode === "go" ? (
              // The only link on the card: a trade page has no menu item.
              // The user clicks it; the tour itself never navigates.
              goToTrade && (
                <Link
                  href={goToTrade}
                  onClick={() => setNavClicked(true)}
                  className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-white hover:brightness-110 dark:text-zinc-950"
                >
                  Open your trade
                </Link>
              )
            ) : cardMode === "loading" ? null : (
            <button
              onClick={() => (isLast ? finish("completed") : goForward(stepIndex))}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium ${
                step.action && !isLast
                  ? "border border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
                  : "bg-primary text-white hover:brightness-110 dark:text-zinc-950"
              }`}
            >
              {primaryLabel}
            </button>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
