"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DESIGN_KEY, DESIGN_TOGGLE_KEY, type DesignMode } from "@/components/design/design-flag";

// "off" means do not render at all. Nothing here changes without a reload, so
// there is no store to subscribe to -- useSyncExternalStore is used purely for
// its server snapshot, which keeps the pill out of the server-rendered HTML
// and out of hydration.
type ToggleState = "off" | DesignMode;

function subscribe() {
  return () => {};
}

function getSnapshot(): ToggleState {
  let allowed = process.env.NODE_ENV !== "production";
  if (!allowed) {
    try {
      allowed = localStorage.getItem(DESIGN_TOGGLE_KEY) === "1";
    } catch {
      // Storage unavailable, so there is no opt-in to honour.
    }
  }
  if (!allowed) return "off";
  return document.documentElement.dataset.design === "v2" ? "v2" : "v1";
}

function getServerSnapshot(): ToggleState {
  return "off";
}

// A full reload rather than flipping the attribute in place: server-rendered
// markup and any component that read the flag through useDesign() would
// otherwise be left describing the other design.
function choose(next: DesignMode) {
  try {
    localStorage.setItem(DESIGN_KEY, next);
  } catch {
    // Nothing to persist to; the reload will land back on V1.
  }
  location.reload();
}

/**
 * Two-segment V1/V2 switch pinned bottom-right.
 *
 * Deliberately styled with inline styles rather than utility classes: it has
 * to look the same in both designs, so it must sit outside everything the V2
 * stylesheet does. It is scaffolding, not part of either design.
 *
 * Visible only in development, or in a production session that has opted in by
 * setting `tl-design-toggle` to "1" by hand. Both checks happen on the client
 * only, so the server never renders it and a normal production visitor never
 * receives it in their HTML.
 */
export function DesignToggle() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (state === "off" || process.env.NODE_ENV === "production") return;
    // The escape hatch, in case the pill itself is ever unreachable -- covered
    // by an overlay, off-screen on a narrow viewport, or broken by the very
    // styles being worked on.
    console.info(
      `[design] back to V1: localStorage.setItem('${DESIGN_KEY}','v1');location.reload()`,
    );
  }, [state]);

  if (state === "off") return null;

  return (
    <div
      // Marks the whole pill as scaffolding rather than app UI, so a V1/V2
      // style comparison can exclude it.
      data-v2-toggle
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 2147483647,
        display: "flex",
        font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
        border: "1px solid #6B757E",
        background: "#0B0D0F",
        color: "#9AA4AD",
      }}
    >
      {(["v1", "v2"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-pressed={state === value}
          style={{
            padding: "3px 9px",
            border: 0,
            cursor: "pointer",
            font: "inherit",
            letterSpacing: "0.08em",
            background: state === value ? "#C8862A" : "transparent",
            color: state === value ? "#0B0D0F" : "inherit",
          }}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
