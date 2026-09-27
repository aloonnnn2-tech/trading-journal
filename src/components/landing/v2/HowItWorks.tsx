import { Reveal } from "@/components/motion/Reveal";

// How it works: screenshot in, trade card out, execution reviewed. Three
// columns, each with its FREE/PAID label (Phase 3A of docs/design-audit.md,
// target order #6). The hero's "See how it works" button lands here.
//
// This replaced a rotating 3D card stack. The stack showed one step at a
// time, needed a timer to reveal the other two, and went through several
// rounds of fixes around reduced motion; three columns show all three steps
// at once, with nothing to wait for. Alon chose columns from the 3A sketch on
// 2026-09-27. The step copy is unchanged from the stack.

const STEPS = [
  {
    number: "01",
    word: "Upload",
    paid: false,
    headline: "Drop in a screenshot",
    body: "Take it from your broker or platform. The app's own reader parses it, and nothing is sent to a third-party AI service.",
  },
  {
    number: "02",
    word: "Extract",
    paid: false,
    headline: "It becomes a trade card",
    body: "Symbol, direction, entry, exit and size are read off the image and filled in for you, each with a confidence mark to check before you save.",
  },
  {
    number: "03",
    word: "Review",
    paid: true,
    headline: "Get an AI review",
    body: "Every closed trade scored on how it was executed, not on whether it won. A winning trade can still score poorly.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 sm:px-10">
      <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center gap-3 text-center">
        <Reveal as="span" className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          How it works
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="text-3xl font-bold tracking-heading text-zinc-900 dark:text-zinc-50 sm:text-4xl lg:text-h2">
            From screenshot to review
          </h2>
        </Reveal>
      </div>

      <ol className="grid gap-4 md:grid-cols-3 md:gap-5">
        {STEPS.map((step, i) => (
          <Reveal
            as="li"
            key={step.number}
            delay={i * 0.05}
            className={`flex flex-col gap-3 rounded-xl border bg-white p-6 dark:bg-card ${
              step.paid ? "border-primary/50" : "border-zinc-200 dark:border-subtle"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-zinc-500">
                {step.number} · {step.word}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  step.paid
                    ? "border-primary/40 text-primary"
                    : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                {step.paid ? "Paid" : "Free"}
              </span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{step.headline}</h3>
            <p className="text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">{step.body}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
