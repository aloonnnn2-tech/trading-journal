import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEmotionBreakdown, getEmotionHistory } from "@/lib/emotions/queries";
import { Card } from "@/components/ui/Card";

export default async function EmotionsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const [history, breakdown] = await Promise.all([
    getEmotionHistory(supabase, 25),
    getEmotionBreakdown(supabase),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Emotion Tracking</h1>
        <p className="mt-0.5 text-sm text-zinc-500">How your state of mind shows up in your results.</p>
      </div>

      <Card hoverable={false}>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Win rate by emotion before trade
        </h2>
        {breakdown.length === 0 ? (
          <p className="text-sm text-zinc-500">No emotion data on closed trades yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="py-1.5 text-left font-medium">Emotion</th>
                <th className="py-1.5 text-right font-medium">Trades</th>
                <th className="py-1.5 text-right font-medium">Win rate</th>
                <th className="py-1.5 text-right font-medium">Total P/L</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.emotion} className="border-t border-zinc-100 dark:border-subtle">
                  <td className="py-2 text-zinc-900 dark:text-zinc-100">{row.emotion}</td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{row.trades}</td>
                  <td className="tnum py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">
                    {row.winRate === null ? "—" : `${(row.winRate * 100).toFixed(0)}%`}
                  </td>
                  <td className={`tnum py-2 text-right font-mono ${row.totalPL >= 0 ? "text-profit" : "text-loss"}`}>
                    {row.totalPL < 0 ? "−" : "+"}${Math.abs(row.totalPL).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card hoverable={false}>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
          Recent emotion history
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">No emotion entries yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.tradeId}>
                <Link
                  href={`/trades/${entry.tradeId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {entry.ticker || "Untitled"}{" "}
                    <span className="text-xs text-zinc-500">
                      {entry.date ? new Date(entry.date).toLocaleDateString() : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1 text-xs">
                    {entry.before.map((e) => (
                      <span key={`before-${e}`} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                        Before: {e}
                      </span>
                    ))}
                    {entry.during.map((e) => (
                      <span key={`during-${e}`} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-500">
                        During: {e}
                      </span>
                    ))}
                    {entry.after.map((e) => (
                      <span key={`after-${e}`} className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                        After: {e}
                      </span>
                    ))}
                    {entry.intensity !== null && (
                      <span className="tnum rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {entry.intensity}/10
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
