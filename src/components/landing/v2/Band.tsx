import type { ReactNode } from "react";

// A full-width section band, alternating base and raised down the homepage
// (docs/design-audit.md, "Design tokens": sections alternate #101010 /
// #161615). Phase 2A.
//
// A raised band is a solid surface with a hairline along each edge and its
// own dot lattice. The first version was a see-through 2.7% wash over the
// page's dots, and its edges read as a smudge rather than a line: a ~2%
// brightness step with nothing to define it, and the page's dots crossing it
// at whatever offset the band happened to land on (Alon, 2026-09-26: "low
// quality ... make them more straight and lined better"). Now:
//
//  - the edges are 1px hairlines in --color-subtle, the same line every card
//    on this page is drawn with. Inset shadows rather than borders, so they
//    add no height;
//  - the dots are drawn by the band itself, anchored to its own top-left
//    corner, so every band's first row sits exactly half a cell (12px) below
//    its top line. The columns fall on the same 24px grid as the page's dots,
//    so they continue straight through the edge. The dots were the point of
//    choosing see-through, and they are kept;
//  - being solid, it lands on the spec's #161615 exactly.
//
// The band owns the vertical rhythm: 48px above and below. Every banded
// section gave up its own 96px bottom padding for it, so the gap between two
// sections' content is the same 96px it always was and the page is no
// longer. "Do not add scroll length" is a standing homepage rule; the height
// is measured against main to prove it.
export function Band({ tone, children }: { tone: "base" | "raised"; children: ReactNode }) {
  if (tone === "base") return <div className="py-12">{children}</div>;
  return (
    <div className="relative bg-band-raised py-12 shadow-[inset_0_1px_0_var(--color-subtle),inset_0_-1px_0_var(--color-subtle)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 inset-y-px text-zinc-900/[0.10] dark:text-white/[0.08] [background-image:radial-gradient(currentColor_1px,transparent_1.5px)] [background-size:24px_24px] [background-position:0_-1px]"
      />
      {/* Positioned, so the section paints above the dot layer. */}
      <div className="relative">{children}</div>
    </div>
  );
}
