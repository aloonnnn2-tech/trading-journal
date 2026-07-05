const STEPS = [
  {
    number: "01",
    title: "Log the trade",
    description: "Enter price, size, and setup in under a minute.",
  },
  {
    number: "02",
    title: "Review the data",
    description: "Equity curve, win rate, and R-multiples update automatically.",
  },
  {
    number: "03",
    title: "Spot the pattern",
    description: "See which setups, times, and emotions actually make you money.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 pb-24 sm:px-10">
      <div className="grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-subtle dark:bg-subtle sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.number} className="flex flex-col gap-3 bg-white p-6 dark:bg-card">
            <span className="tnum inline-flex w-fit items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 font-mono text-lg font-semibold tracking-tight text-primary dark:bg-black/30">
              {step.number}
              <span className="text-[10px] font-normal text-zinc-400 dark:text-zinc-600">/03</span>
            </span>
            <h3 className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{step.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
