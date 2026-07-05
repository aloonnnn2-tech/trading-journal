import Link from "next/link";

export function ClosingCTA() {
  return (
    <section className="px-6 pb-24 sm:px-10">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-subtle dark:bg-card">
        {/* recessive chart-line motif */}
        <svg
          viewBox="0 0 800 160"
          className="pointer-events-none absolute inset-x-0 bottom-0 w-full opacity-[0.07]"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <polyline
            points="0,140 60,128 120,134 180,112 240,120 300,96 360,104 420,82 480,90 540,64 600,72 660,44 720,52 800,24"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
        <div className="relative flex flex-col items-center gap-4 px-6 py-16 text-center sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Your next trade deserves a record.
          </h2>
          <p className="max-w-md text-zinc-600 dark:text-zinc-400">
            Create a free account in seconds — free forever, no credit card required.
          </p>
          <Link
            href="/sign-up"
            className="mt-2 rounded-lg bg-primary px-6 py-3 font-medium text-white dark:text-zinc-950 shadow-lg shadow-primary/25 hover:brightness-110"
          >
            Start journaling free
          </Link>
        </div>
      </div>
    </section>
  );
}
