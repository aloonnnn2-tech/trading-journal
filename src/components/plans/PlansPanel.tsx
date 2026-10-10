"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CalendarRange,
  Check,
  Clock,
  Crosshair,
  FileText,
  Gauge,
  MessageSquareText,
  Ruler,
  Sparkles,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { useDialog } from "@/lib/a11y/use-dialog";
import { createClient } from "@/lib/supabase/client";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { FREE_FEATURES, PAID_FEATURES, type PaidFeatureId } from "@/lib/plans/paid-features";

// Free vs Paid, opened in place from any "See plans" button. Those buttons
// used to link to /#pricing, and the homepage sends a signed-in visitor to
// the dashboard -- so a free user who met a paid feature landed somewhere
// unrelated and never saw the plans (Alon, 2026-10-10).
//
// The paid card is the hero, dressed like the homepage's paid card (border
// beam, glow, shimmer), because this is the moment someone has just reached
// for a paid feature (Alon: "way more selling and inviting").
//
// The selling stays honest (docs/design-audit.md, the one rule): billing is
// not live, so no price, no "Upgrade", nothing that looks buyable, no
// countdown and no invented numbers. Every line comes from the shared list in
// src/lib/plans/paid-features.ts, which /paid-plan reads too. The action is
// the real one: the waitlist, with the user's own address filled in.

const ICONS: Record<PaidFeatureId, LucideIcon> = {
  edge: Crosshair,
  excursions: Ruler,
  scorecards: Trophy,
  "analysis-panels": Gauge,
  "trade-review": Sparkles,
  "period-review": CalendarRange,
  ask: MessageSquareText,
  reports: FileText,
};

export function PlansPanel({
  open,
  onClose,
  feature,
}: {
  open: boolean;
  onClose: () => void;
  /** The paid feature the reader just met: named at the top and lit in the list. */
  feature?: PaidFeatureId;
}) {
  const titleId = useId();
  const dialogRef = useDialog({ open, onClose });
  const [email, setEmail] = useState<string | undefined>(undefined);

  // The account's address, so joining the waitlist is one click. Read from
  // the session already in the browser; no request if it isn't there.
  useEffect(() => {
    if (!open || email !== undefined) return;
    let live = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (live) setEmail(data.session?.user.email ?? "");
      })
      .catch(() => {
        if (live) setEmail("");
      });
    return () => {
      live = false;
    };
  }, [open, email]);

  const met = feature ? PAID_FEATURES.find((f) => f.id === feature) : undefined;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-4 outline-none dark:border-subtle dark:bg-card sm:max-w-3xl sm:rounded-2xl sm:p-6"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close plans"
              className="absolute right-6 top-6 z-10 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 sm:right-9 sm:top-9"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>

            {/* ---- The paid plan: the hero ---------------------------------- */}
            <section className="relative overflow-hidden rounded-2xl border border-primary/50 bg-white p-5 shadow-[0_24px_80px_-32px_color-mix(in_srgb,var(--color-primary)_55%,transparent)] dark:bg-card sm:p-7">
              <BorderBeam size={140} duration={7} />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.08] via-transparent to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-primary)_30%,transparent),transparent_70%)]"
              />

              <div className="relative flex flex-wrap items-center justify-center gap-3">
                <p
                  className="animate-text-shimmer bg-[length:200%_auto] bg-clip-text font-mono text-[11px] uppercase tracking-[0.22em] text-transparent"
                  style={{
                    backgroundImage: "linear-gradient(90deg, var(--color-primary), var(--color-accent), var(--color-primary))",
                  }}
                >
                  Paid plan
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  Coming soon
                </span>
              </div>

              <h2
                id={titleId}
                className="relative mx-auto mt-4 max-w-xl text-center text-2xl font-semibold leading-[1.15] tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[32px]"
              >
                See which parts of your trading are carrying the account.
              </h2>
              <p className="relative mx-auto mt-3 max-w-lg text-center text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                The free plan keeps the record. The paid plan reads it back: what pays, what leaks,
                and what to fix next. Everything in Free stays.
              </p>

              {met && (
                <p className="relative mx-auto mt-4 w-fit rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-center text-xs text-zinc-700 dark:text-zinc-300">
                  You just opened <span className="font-semibold text-zinc-900 dark:text-zinc-50">{met.name}</span>.
                  It&apos;s in here.
                </p>
              )}

              <ul className="relative mt-6 grid gap-2.5 sm:grid-cols-2">
                {PAID_FEATURES.map((f) => {
                  const Icon = ICONS[f.id];
                  const lit = f.id === feature;
                  return (
                    <li
                      key={f.id}
                      aria-current={lit ? "true" : undefined}
                      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition sm:py-3 ${
                        lit
                          ? "border-primary/60 bg-primary/10 shadow-[0_8px_24px_-12px_color-mix(in_srgb,var(--color-primary)_60%,transparent)]"
                          : "border-zinc-200 bg-white/70 dark:border-subtle dark:bg-zinc-950/40"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          lit ? "bg-primary text-white dark:text-zinc-950" : "bg-primary/10 text-primary"
                        }`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">{f.name}</span>
                        {/* On a phone, only the feature just opened keeps its line, so the
                            button isn't a long scroll away. */}
                        <span
                          className={`mt-0.5 text-[13px] leading-snug text-zinc-600 dark:text-zinc-400 sm:block ${lit ? "block" : "hidden"}`}
                        >
                          {f.pitch}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="relative mt-3 text-center text-xs text-zinc-500">
                AI features run on your own API key, so AI use is never marked up.
              </p>

              <div className="relative mt-6">
                {/* Mounted once the address is known, so it starts filled in. */}
                {email !== undefined && (
                  <WaitlistForm source="app-plans-panel" defaultEmail={email || undefined} hero />
                )}
                <p className="mt-1 text-center text-xs text-zinc-500">
                  Not on sale yet, so there&apos;s no price and nothing to buy.
                </p>
                <Link
                  href="/paid-plan"
                  data-track="plans-details"
                  className="mx-auto mt-3 flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  How every paid feature works
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </Link>
              </div>
            </section>

            {/* ---- What they have now ------------------------------------- */}
            <section className="mt-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-subtle">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Free</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Your plan</span>
                <span className="text-xs text-zinc-500">· a complete journal, not a trial</span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-600 dark:text-zinc-400">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 shrink-0 text-zinc-400" strokeWidth={2.5} />
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
