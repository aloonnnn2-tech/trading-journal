// "How did you hear about us?" -- one bar per answer, most first. A single
// series, so one colour and no legend. Plain HTML rather than a chart
// library: the list is short and ranked, and every row must show its number
// -- a channel nobody picked reads "0", where Recharts drew nothing at all.
export function HeardFromChart({ data }: { data: { label: string; count: number; pct: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Answers to how did you hear about us">
      {data.map((d) => (
        <li
          key={d.label}
          className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-sm"
          title={`${d.label}: ${d.count} account${d.count === 1 ? "" : "s"} (${d.pct}% of answers)`}
        >
          <span className="truncate text-right text-xs text-zinc-500 dark:text-zinc-400">{d.label}</span>
          <span className="h-5 rounded-r-[4px] bg-zinc-100 dark:bg-zinc-800/60">
            {d.count > 0 && (
              <span
                className="block h-full rounded-r-[4px] bg-primary transition-[width] duration-500"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            )}
          </span>
          <span className="tnum font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {d.count}
            {d.count > 0 && <span className="text-zinc-400 dark:text-zinc-500"> · {d.pct}%</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
