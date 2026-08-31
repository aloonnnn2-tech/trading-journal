import Link from "next/link";
import { Construction, KeyRound, Sparkles } from "lucide-react";

const FREE_FEATURES = [
  "Unlimited trade logging",
  "Equity, drawdown & win-rate analytics",
  "CSV / XLSX / JSON import & export",
  "Full version history",
];

// Only the feature that actually exists and is gated behind isPaidUser today
// (src/lib/settings/plan.ts) -- the Ask Your Journal panel at /ask. Listing
// anything else here would be promising something the paid plan does not yet
// do, which is the one thing a pricing card must never do.
const PAID_FEATURES = [
  {
    icon: Sparkles,
    text: "Ask Your Journal — free-text questions about your own trades, answered from your real history",
  },
  {
    icon: KeyRound,
    text: "Bring your own API key — OpenAI, Anthropic, Google, Groq, OpenRouter or Cerebras",
  },
];

export function PricingTeaser() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-3xl scroll-mt-20 px-6 pb-24 sm:px-10">
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-subtle dark:bg-card">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Free
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">$0</p>
          <ul className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            {FREE_FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Link
            href="/sign-up"
            className="mt-6 block rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
          >
            Start journaling free
          </Link>
        </div>

        {/* Deliberately carries no price and no checkout button. There is no
            billing system in the app -- plan.ts spells this out: `plan` is set
            by hand with the service-role key, there is no Stripe and no
            webhook. A "Subscribe" button would lead nowhere, and a price would
            be a number nobody can actually pay, so the card says plainly that
            it is still being built. */}
        <div className="relative rounded-xl border border-primary/40 bg-white p-6 dark:bg-card">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Paid</p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Construction className="h-3 w-3" strokeWidth={2} />
              Under construction
            </span>
          </div>

          <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Coming soon
          </p>
          <p className="mt-1 text-sm text-zinc-500">Pricing not announced yet.</p>

          <ul className="mt-4 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
            {PAID_FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
                <span>{text}</span>
              </li>
            ))}
            <li className="flex items-start gap-2 text-zinc-500">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={2} />
              <span>More features coming soon</span>
            </li>
          </ul>

          <p className="mt-6 rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Still building — not available to buy yet
          </p>
        </div>
      </div>
    </section>
  );
}
