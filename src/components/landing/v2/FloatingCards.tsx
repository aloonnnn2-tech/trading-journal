// Three small cards overlapping the hero's product preview (Phase 3A of
// docs/design-audit.md, target order #4). Each names something the product
// actually does, with a real figure from the demo account:
//
//  - "Rule broken: stop moved after entry": "Moved stop" is a mistake the
//    plan-rule engine detects (src/lib/trades/adjustments + plan-rules).
//  - "AI review 78/100 · Exit 61": the demo account's review, the same
//    figures the How-it-works and pricing cards already show.
//  - "MAE −2.47%": the demo account's average adverse excursion, from its
//    MAE/MFE panel (the screenshot's alt text states it).
//
// aria-hidden: they are decoration over a decorative preview, and every fact
// in them is on the page as real text elsewhere.
//
// OVERHANG. They sit half off the preview's edges, and how far is set by the
// narrowest desktop, not the widest. At 1024px the preview column is ~429px
// wide with 40px of page padding outside it and a 64px gap to the hero text,
// so the cards overhang 12px at lg and 28px only from xl (1280px) up -- never
// within 16px of the screen edge, where the page's overflow-x-clip would cut
// them, and never within 36px of the text. Below lg the hero stacks and the
// preview is full width, so they are hidden rather than crowding it.
//
// The review card sits at 56% down the right edge, not a third: higher up it
// covered the chart's own hover label ("Jun 4 · 2:15 PM · +$1,240").
//
// Entrance: the hero's CSS rise, after the panel, so it starts at first paint
// and the reduced-motion rule stills it with everything else.

const rise = (ms: number) => ({ animationDelay: `${ms}ms` });

const CARD =
  "pointer-events-none absolute z-10 hidden animate-rise-right items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-[13px] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.45)] lg:flex";

export function FloatingCards() {
  return (
    <div aria-hidden="true">
      <div
        className={`${CARD} -left-3 -top-4 border-loss/60 bg-white text-zinc-800 dark:bg-[#1f1714] dark:text-zinc-100 xl:-left-7`}
        style={rise(400)}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-loss" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Rule broken: stop moved after entry
      </div>

      <div
        className={`${CARD} -right-3 top-[56%] border-primary/60 bg-white text-zinc-800 dark:bg-[#0f1827] dark:text-zinc-100 xl:-right-7`}
        style={rise(460)}
      >
        <span className="font-semibold">AI review 78/100</span>
        <span className="text-zinc-500 dark:text-zinc-400">· Exit 61</span>
      </div>

      <div
        className={`${CARD} -bottom-4 -left-3 border-zinc-200 bg-white text-zinc-800 dark:border-subtle dark:bg-card dark:text-zinc-100 xl:-left-7`}
        style={rise(520)}
      >
        MAE <span className="tnum font-mono text-loss">−2.47%</span>
        <span className="text-zinc-500 dark:text-zinc-400">· you sat through the heat</span>
      </div>
    </div>
  );
}
