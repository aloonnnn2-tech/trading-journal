import Link from "next/link";

const FREE_FEATURES = [
  "Unlimited trade logging",
  "Equity, drawdown & win-rate analytics",
  "CSV / XLSX / JSON import & export",
  "Full version history",
];

export function PricingTeaser() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-md scroll-mt-20 px-6 pb-24 sm:px-10">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-subtle dark:bg-card">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">Free</p>
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
    </section>
  );
}
