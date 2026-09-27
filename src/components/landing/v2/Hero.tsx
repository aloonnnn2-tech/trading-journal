"use client";

import { Fragment } from "react";
import Link from "next/link";
import { HeroPanel } from "@/components/landing/v2/HeroPanel";
import { Marquee } from "@/components/landing/v2/Marquee";

// The hero for /home-v2. Same copy and layout as ../Hero.tsx, which stays
// untouched so the current homepage is unaffected. What changes is scale --
// the headline steps up one size at every breakpoint and the mono eyebrow is
// large enough to read as a typographic choice rather than a label -- and
// motion: the headline arrives a word at a time, "pattern" carries a slow
// shimmer, the primary button catches a light every few seconds, and the
// capability strip runs as a ticker.
//
// The stagger is deliberately tight. It used to run 80ms to 540ms behind a
// 500ms blur-in, so the buttons -- the whole point of a hero -- landed a
// second after the page did. Each piece now moves 8px over 200ms, and the
// last one starts at 340ms (issue 7 of docs/design-audit.md).
//
// Every entrance here is a CSS animation, not framer: it is above the fold,
// and a CSS animation starts at first paint, where a framer `initial` state
// ships as opacity 0 and waits for hydration. The text column comes in from
// the left and the panel from the right -- each side from its own side.

// "every trade." is one token (non-breaking space) so the line breaks where
// it always did.
const HEADLINE = ["See", "the", "pattern", "behind", "every trade."];

const CAPABILITIES = [
  "equity curve",
  "r-multiples",
  "trading rules",
  "mistake tracking",
  "goals",
  "pattern detection",
  "csv / xlsx import",
];

const rise = (ms: number) => ({ animationDelay: `${ms}ms` });

export function Hero() {
  return (
    <section className="relative px-6 pt-16 pb-8 sm:px-10 lg:pt-24 lg:pb-16">
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="flex flex-col items-start gap-6 text-left">
          <span className="animate-rise-left font-mono text-xs uppercase tracking-[0.2em] text-primary sm:text-sm">
            Free · No credit card
          </span>
          <h1 className="max-w-2xl text-5xl font-bold leading-[1.02] tracking-heading text-zinc-900 dark:text-zinc-50 sm:text-6xl lg:text-7xl">
            {HEADLINE.map((word, i) => (
              <Fragment key={word}>
                {/* The space sits between the spans: inside an inline-block a
                    trailing space collapses and the words run together. */}
                {i > 0 && " "}
                <span className="inline-block animate-rise-left" style={rise(40 + i * 40)}>
                  {word === "pattern" ? (
                    <span
                      className="animate-text-shimmer bg-[length:200%_auto] bg-clip-text text-transparent"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, var(--color-primary), var(--color-accent), var(--color-primary))",
                      }}
                    >
                      pattern
                    </span>
                  ) : (
                    word
                  )}
                </span>
              </Fragment>
            ))}
          </h1>
          <p
            className="max-w-lg animate-rise-left text-lg leading-relaxed text-zinc-600 dark:text-zinc-400"
            style={rise(220)}
          >
            Record a trade in about a minute, then write down the rules you trade by.
            Every entry is checked against them, so you can see which setups earn their
            place and what your habits actually cost you.
          </p>
          <div className="flex animate-rise-left flex-wrap gap-3" style={rise(280)}>
            <Link
              href="/sign-up"
              className="relative overflow-hidden rounded-lg bg-primary px-6 py-3 font-medium text-white dark:text-zinc-950 shadow-lg shadow-primary/25 hover:bg-primary-hover"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.35)_50%,transparent_65%)]"
              />
              <span className="relative">Start journaling free</span>
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-zinc-300 px-6 py-3 font-medium text-zinc-900 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500"
            >
              Log in
            </Link>
          </div>
          {/* The proof line (Phase 2C). Not the spec's wording, and not by
              accident: "Every edit versioned" is false -- each trade keeps
              its newest 50 versions -- and "Your AI key, your data" named a
              paid-only feature nobody can buy yet. Alon chose this line on
              2026-09-27. "Free forever" is a promise; /paid-plan already
              makes it ("nothing in it expires"). */}
          <p
            className="animate-rise-left font-mono text-xs text-zinc-500 dark:text-zinc-400"
            style={rise(310)}
          >
            Free forever · No card · Export anytime · Edit history on every trade
          </p>
          <div className="w-full max-w-lg animate-rise-left" style={rise(340)}>
            <Marquee className="mt-2 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
              {CAPABILITIES.map((c) => (
                <span key={c} className="flex items-center gap-[var(--gap)] whitespace-nowrap">
                  {c}
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                </span>
              ))}
            </Marquee>
          </div>
        </div>
        <div className="relative animate-rise-right" style={rise(100)}>
          <HeroPanel />
        </div>
      </div>
    </section>
  );
}
