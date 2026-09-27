"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { ProductShotFrame } from "@/components/landing/ProductShotFrame";
import { Reveal } from "@/components/motion/Reveal";
import { TOUR_TABS, type TourTab, type TourVisual } from "@/components/landing/v2/tour-content";

// The tabbed tour (Phase 3B of docs/design-audit.md), in place of the three
// feature stories, the Find My Edge plate and "Three jobs a plain record
// leaves to you" -- every point those made is in one of these tabs, now with
// its FREE/PAID badge. Copy and badges live in tour-content.ts.
//
// ARIA tab pattern with automatic activation: ArrowLeft/Right move focus and
// selection together (wrapping), Home/End jump to the ends, and only the
// selected tab is in the Tab order, so Tab goes from it into its panel.
//
// All five panels are in the server HTML and share one grid cell. The
// inactive ones are invisible and inert rather than display:none, so the cell
// is always as tall as the tallest panel and switching tabs never moves the
// page under the reader. Nothing rotates on its own: a panel that changed
// while someone read it is what WCAG 2.2.2 rules out, and here there is no
// reason to take that on.

const SHOT_SIZES = "(max-width: 1024px) 100vw, 660px";

// The spec's kept caption. All three screenshots come from the demo account
// (scripts/capture-marketing-shots.mjs signs in as demo@tradinglens.app).
const DEMO_CAPTION =
  "Captured from the app. Figures come from the demo account, so they are seeded rather than anyone’s real trading history.";

// The review card's six sub-scores, in the real card's order
// (src/components/ai-review/trade-review-card.tsx). Same figures as How it
// works and the pricing card.
const BREAKDOWN: [string, number][] = [
  ["Setup", 84],
  ["Entry", 82],
  ["Risk", 91],
  ["Exit", 61],
  ["Plan", 75],
  ["Discipline", 70],
];

// Only the confirmed routes -- see "Facts Alon supplies" in the spec.
const IMPORT_ROUTES: { label: string; value: string; note: string }[] = [
  { label: "Screenshot import", value: "Interactive Brokers · stocks", note: "Confirmed" },
  { label: "Manual entry", value: "Any broker or market", note: "Saves as you type" },
  // api/trades/export sends every trade (optionally one folder's). Not "your
  // whole journal": goals, notes pages and the rest aren't in it.
  { label: "Export", value: "Excel (XLSX)", note: "Every trade" },
];

function ImportCard() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">Ways in, and out</p>
      <ul className="mt-4 flex flex-col">
        {IMPORT_ROUTES.map((route) => (
          <li
            key={route.label}
            className="flex items-center gap-4 border-t border-zinc-200 py-4 first:border-t-0 first:pt-0 last:pb-0 dark:border-subtle"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.1em] text-zinc-500">{route.label}</p>
              <p className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">{route.value}</p>
            </div>
            <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{route.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewCard() {
  return (
    <figure className="m-0">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-subtle dark:bg-card sm:p-6">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          AI Trade Review
        </p>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <p className="tnum font-mono text-5xl font-semibold leading-none text-profit">78</p>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">/ 100 · execution</p>
          </div>
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {BREAKDOWN.map(([label, value]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-zinc-500">{label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
                </div>
                <span className="tnum w-6 shrink-0 text-right font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Sample review</figcaption>
    </figure>
  );
}

function Visual({ kind }: { kind: TourVisual }) {
  switch (kind) {
    case "rules":
      return (
        <div className="flex flex-col gap-4">
          <ProductShotFrame
            src="/screenshots/plan.png"
            alt="The Plan Adherence panel on a closed trade: the Earnings Gap Fade strategy scored 2 of 3, with the risk rule marked broken because 0.73 percent was risked against a 0.5 percent limit."
            width={1908}
            height={552}
            sizes={SHOT_SIZES}
          />
          {/* Cropped to its first rows with a fade. Whole, this tab stood
              ~300px taller than the others, and since every panel shares the
              tallest one's height, each other tab sat in a mostly empty box. */}
          <div className="max-h-64 overflow-hidden rounded-xl [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
            <ProductShotFrame
              src="/screenshots/mistakes.png"
              alt="The Mistakes panel: recurring errors across 327 closed trades, each showing expectancy with that mistake against every other trade."
              width={1992}
              height={1347}
              sizes={SHOT_SIZES}
            />
          </div>
          <p className="-mt-1 text-sm text-zinc-500 dark:text-zinc-400">{DEMO_CAPTION}</p>
        </div>
      );
    case "excursion":
      return (
        <ProductShotFrame
          src="/screenshots/excursion.png"
          alt="The MAE and MFE panel: average adverse excursion of -2.47 percent, average favourable excursion of +3.55 percent, and a 39 percent median capture rate across 132 measured trades."
          width={1992}
          height={699}
          sizes={SHOT_SIZES}
          caption={DEMO_CAPTION}
        />
      );
    case "edge":
      return (
        <ProductShotFrame
          src="/screenshots/edge.png"
          alt="The Find My Edge panel: strongest edges on the left ranked by expectancy in R, biggest leaks on the right. Each row shows the trade count and total R behind the figure."
          width={3732}
          height={1494}
          sizes={SHOT_SIZES}
          caption={DEMO_CAPTION}
        />
      );
    case "import":
      return <ImportCard />;
    case "review":
      return <ReviewCard />;
  }
}

function Badge({ paid }: { paid: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
        paid
          ? "border-primary/40 text-primary"
          : "border-zinc-200 text-zinc-400 dark:border-subtle dark:text-zinc-500"
      }`}
    >
      {paid ? "Paid" : "Free"}
    </span>
  );
}

function Panel({ tab, active }: { tab: TourTab; active: boolean }) {
  return (
    <div
      role="tabpanel"
      id={`tour-panel-${tab.id}`}
      aria-labelledby={`tour-tab-${tab.id}`}
      // Focusable only while it is the one showing (the ARIA pattern's panel
      // stop); inert hides the others from keyboard and screen readers.
      tabIndex={active ? 0 : -1}
      inert={!active}
      // content-start: stacked (below lg), a shorter panel keeps its text and
      // picture together and leaves the spare height below them, rather than
      // the grid stretching the gap between the two.
      className={`grid content-start gap-8 rounded-2xl lg:content-center transition-opacity duration-200 ease-out [grid-area:1/1] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-12 ${
        active ? "opacity-100" : "invisible opacity-0"
      }`}
    >
      <div className="flex flex-col items-start gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{tab.eyebrow}</span>
          <Badge paid={tab.paid} />
        </div>
        <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {tab.headline}
        </h3>
        <ul className="flex flex-col gap-3">
          {tab.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2.5 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              <Check className="mt-1 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
              {bullet}
            </li>
          ))}
        </ul>
        {/* "Paid" alone reads as buyable today, and it isn't yet. */}
        {tab.paid && (
          <a href="#waitlist" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            Part of the paid plan, coming soon.
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              Join the waitlist
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </a>
        )}
      </div>
      <div className="min-w-0">
        <Visual kind={tab.visual} />
      </div>
    </div>
  );
}

export function FeatureTour() {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    setSelected(index);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = TOUR_TABS.length - 1;
    // From the tab that has focus, which is normally the selected one.
    const focused = tabRefs.current.findIndex((el) => el === document.activeElement);
    const from = focused === -1 ? selected : focused;
    const next =
      e.key === "ArrowRight" ? (from === last ? 0 : from + 1)
      : e.key === "ArrowLeft" ? (from === 0 ? last : from - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 sm:px-10">
      <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center gap-3 text-center">
        <Reveal as="span" className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          Tour
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="text-3xl font-bold tracking-heading text-zinc-900 dark:text-zinc-50 sm:text-4xl lg:text-h2">
            What it does after you log a trade
          </h2>
        </Reveal>
      </div>

      <Reveal>
        <div
          role="tablist"
          aria-label="Feature tour"
          onKeyDown={onKeyDown}
          className="mx-auto mb-10 flex max-w-3xl flex-wrap justify-center gap-2"
        >
          {TOUR_TABS.map((tab, i) => {
            const active = i === selected;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`tour-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`tour-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => select(i)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  active
                    ? "border-primary/60 bg-primary/10 text-zinc-900 dark:text-zinc-50"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-subtle dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="grid">
          {TOUR_TABS.map((tab, i) => (
            <Panel key={tab.id} tab={tab} active={i === selected} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}
