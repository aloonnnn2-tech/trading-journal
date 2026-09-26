"use client";

import { Reveal } from "@/components/motion/Reveal";

// The centred section headline. Same markup as ../SectionHeadline.tsx.
//
// The heading used to arrive a word at a time behind a 0.1s delay, so a
// section's own title was the slowest thing in it to appear. Both parts now
// render complete and rise 8px (issue 7 of docs/design-audit.md).
export function SectionHeadline({ kicker, children }: { kicker?: string; children: string }) {
  return (
    <div className="px-6 pb-14 sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        {kicker && (
          <Reveal as="span" className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            {kicker}
          </Reveal>
        )}
        <Reveal delay={0.05}>
          <h2 className="text-3xl font-bold tracking-heading text-zinc-900 dark:text-zinc-50 sm:text-4xl lg:text-h2">
            {children}
          </h2>
        </Reveal>
      </div>
    </div>
  );
}
