// Click autocapture: one delegated listener that records every interactive
// click, instead of a track() call hand-wired into every button (which drifts
// the moment someone adds a button and forgets).
//
// Two rules make this safe to run on a journal full of private data:
//
//  1. INTERACTIVE TARGETS ONLY. Buttons, links, tabs, menu items, switches.
//     A click on blank page or on running text is not a "button click" and is
//     never recorded. See INTERACTIVE below.
//
//  2. LABELS NEVER CARRY USER CONTENT. The label is what makes a click
//     readable in the admin panel ("Save", "Import", "Skip tour"), and it is
//     derived from developer-authored attributes first -- data-track,
//     aria-label, id, data-tour-id -- and only then from visible text, capped
//     at 40 chars. Any element inside a `data-track-private` ancestor never
//     contributes text at all. That attribute goes on the clickables that
//     render what the user typed: trade rows (a ticker is trade content),
//     folder and strategy names, key labels. The privacy policy promises trade
//     contents never reach analytics; this is the mechanism that keeps it true.
//
// This module is deliberately React-free and DOM-thin so the rule and the
// batcher can be unit-tested with plain objects.

export interface ClickEvent {
  eventName: "click";
  props: {
    label: string | null;
    tag: string;
    path: string;
    role?: string;
  };
}

const INTERACTIVE =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], ' +
  '[role="menuitemcheckbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], ' +
  'input[type="submit"], input[type="button"], input[type="reset"], summary, label';

const MAX_LABEL = 40;

// A link into one specific trade. Its visible text is always record content
// (the ticker, sometimes a note excerpt), so it is private by rule rather
// than by remembering to mark each of the many places that render one. The
// uuid shape keeps static routes like /trades/import out of this.
const TRADE_LINK = /^\/trades\/[0-9a-f]{8}-[0-9a-f-]{27,}/i;

/** The nearest interactive ancestor of a click target, or null. */
export function findInteractive(target: EventTarget | null): Element | null {
  // Duck-typed rather than `instanceof Element`: a text node target has no
  // closest(), and this also holds in environments without a DOM global.
  if (!target || typeof (target as Element).closest !== "function") return null;
  return (target as Element).closest(INTERACTIVE);
}

/**
 * The label for an interactive element. Precedence is the whole privacy
 * story: developer-authored identifiers first, visible text last, and never
 * text from inside a data-track-private subtree.
 */
export function deriveLabel(el: Element): string | null {
  const explicit = el.getAttribute("data-track");
  if (explicit) return clip(explicit);

  const aria = el.getAttribute("aria-label");
  if (aria) return clip(aria);

  if (el.id) return clip(`#${el.id}`);

  const tour = el.getAttribute("data-tour-id");
  if (tour) return clip(tour);

  // Visible text is the fallback, and the one source that can carry user
  // content -- so it is refused anywhere marked private, and refused for a
  // link into an individual trade, whose text is record content by nature.
  // The click still counts, under a fixed label.
  if (el.closest("[data-track-private]")) return null;
  if (el.tagName === "A" && TRADE_LINK.test(el.getAttribute("href") ?? "")) return "trade link";

  // `title` names icon-only buttons (theme toggle, remove-key) that have no
  // text. It sits with text, below the privacy guards, rather than up with
  // aria-label: a title can in principle echo a value, so it gets the same
  // protection text does.
  const title = el.getAttribute("title");
  if (title) return clip(title);

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? clip(text) : null;
}

function clip(s: string): string {
  return s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s;
}

export function describeClick(el: Element, path: string): ClickEvent {
  const role = el.getAttribute("role") ?? undefined;
  return {
    eventName: "click",
    props: {
      label: deriveLabel(el),
      tag: el.tagName.toLowerCase(),
      path,
      ...(role ? { role } : {}),
    },
  };
}

// ---- Batching --------------------------------------------------------------
//
// At "every click" volume, one request per click would be a request per
// keystroke-ish. Clicks are buffered and sent in one POST every few seconds,
// when the buffer fills, or when the page is about to go away.

export interface Batcher<T> {
  push: (item: T) => void;
  flush: () => void;
  size: () => number;
}

export function createBatcher<T>(
  send: (items: T[]) => void,
  { max = 20, intervalMs = 5_000 }: { max?: number; intervalMs?: number } = {},
): Batcher<T> {
  let buffer: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    send(batch);
  }

  function push(item: T) {
    buffer.push(item);
    if (buffer.length >= max) {
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, intervalMs);
    }
  }

  return { push, flush, size: () => buffer.length };
}

// ---- Wiring ----------------------------------------------------------------

/**
 * Installs the capture-phase click listener and returns a teardown. Capture
 * phase, deliberately: a component that calls stopPropagation() in the bubble
 * phase (dropdowns and dialogs do) would otherwise hide its clicks from us.
 *
 * `send` receives batches; the caller decides transport (a keepalive fetch,
 * so the pagehide flush still lands after navigation).
 */
export function startClickCapture(send: (events: ClickEvent[]) => void): () => void {
  const batcher = createBatcher<ClickEvent>(send);

  const onClick = (event: MouseEvent) => {
    const el = findInteractive(event.target);
    if (!el) return;
    batcher.push(describeClick(el, window.location.pathname));
  };
  const onPageHide = () => batcher.flush();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") batcher.flush();
  };

  document.addEventListener("click", onClick, { capture: true });
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
    batcher.flush();
  };
}
