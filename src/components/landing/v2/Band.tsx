import type { ReactNode } from "react";

// A full-width section band, alternating base and raised down the homepage
// (docs/design-audit.md, "Design tokens": sections alternate #101010 /
// #161615). Phase 2A.
//
// The raised tone is see-through (--band-raised in globals.css), so the dot
// lattice under the page shows through every section rather than only the
// base ones -- the ground was chosen deliberately on 13 Sep, and Alon picked
// see-through over solid on 2026-09-26.
//
// The band owns the vertical rhythm: 48px above and below. Every banded
// section gave up its own 96px bottom padding for it, so the gap between two
// sections' content is the same 96px it always was and the page is no
// longer. "Do not add scroll length" is a standing homepage rule; the height
// is measured against main to prove it.
export function Band({ tone, children }: { tone: "base" | "raised"; children: ReactNode }) {
  return <div className={`py-12 ${tone === "raised" ? "bg-band-raised" : ""}`}>{children}</div>;
}
