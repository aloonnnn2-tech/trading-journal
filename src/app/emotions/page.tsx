import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { getEmotionHistory } from "@/lib/emotions/queries";
import { getEmotionReport, type EmotionReport, type TiltGroup } from "@/lib/emotions/report";
import { MIN_SEGMENT_TRADES } from "@/lib/segments/engine";
import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/format/money";
import { ShowMoreOnPhone } from "@/components/mobile/show-more-on-phone";
import { formatR, pct } from "@/lib/emotions/format";
import { PhaseTabs, StatHeader, StatRow } from "./stat-rows";

// Emotion Tracking, rebuilt (2026-10-17). Every figure is from the segments
// engine (src/lib/emotions/report.ts) and carries its trade count; anything
// under MIN_SEGMENT_TRADES is shown faded and never called good or bad.

const HEADING = "text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400";

export default async function EmotionsPage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  // The history needs no timezone, so it doesn't wait for the settings read.
  const historyP = getEmotionHistory(supabase, 25);
  const settings = await getUserSettings(supabase, userId);
  const [history, report] = await Promise.all([historyP, getEmotionReport(supabase, settings.timezone)]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <div data-tour-id="emotions-header">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Emotion Tracking</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Which feelings cost you money, whether you trade differently after losses, and what comes before your
          mistakes.
        </p>
        {report.closedTrades > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Emotions logged on <span className="tnum font-mono">{report.loggedTrades}</span> of{" "}
            <span className="tnum font-mono">{report.closedTrades}</span> closed trades
            {report.loggedTrades < report.closedTrades && ". The more you log, the more this page can tell you"}.
            Faded rows rest on fewer than {MIN_SEGMENT_TRADES} trades.
          </p>
        )}
      </div>

      {report.closedTrades === 0 ? (
        <Card hoverable={false}>
          <p className="text-sm text-zinc-500">
            No closed trades yet. Log how you felt before, during and after a trade on its page, and this fills in
            once it&apos;s closed.
          </p>
        </Card>
      ) : (
        <>
          <Card hoverable={false} className="flex flex-col gap-4">
            <h2 className={HEADING}>Results by emotion</h2>
            <PhaseTabs byPhase={report.byPhase} />
            {report.byIntensity.length > 0 && (
              <div>
                <h3 className="mb-1 mt-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">By how intense it was</h3>
                <StatHeader first="Intensity" />
                {report.byIntensity.map((row) => (
                  <StatRow key={row.emotion} row={row} link={false} />
                ))}
              </div>
            )}
          </Card>

          <TiltCard tilt={report.tilt} />
          <MistakesCard mistakes={report.mistakes} />
          <OverTimeCard periods={report.periods} />
        </>
      )}

      <Card hoverable={false}>
        <h2 className={`mb-4 ${HEADING}`}>Recent emotion history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">No emotion entries yet.</p>
        ) : (
          // Phones: the first three, then "Show all" -- every entry stacked
          // made this page ~5,900px tall on a 360px screen with 36 trades.
          <div className="flex flex-col gap-2">
            <ShowMoreOnPhone count={history.length} noun="entries" className="flex flex-col gap-2">
              {history.map((entry) => (
                <div key={entry.tradeId}>
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
                </div>
              ))}
            </ShowMoreOnPhone>
          </div>
        )}
      </Card>
    </div>
  );
}

/** One plain sentence comparing trades after 2+ losses with the rest -- only when both are big enough to say it. */
function tiltVerdict(tilt: TiltGroup[]): string | null {
  const after = tilt.find((g) => g.key === "after_2_losses");
  const base = tilt.find((g) => g.key === "otherwise");
  if (!after || !base || after.thin || base.thin || after.stats.withR < MIN_SEGMENT_TRADES || base.stats.withR < MIN_SEGMENT_TRADES) {
    return null;
  }
  const a = after.stats.expectancy ?? 0;
  const b = base.stats.expectancy ?? 0;
  // Judged on R AND dollars: R alone once called a streak harmless while
  // those same trades had lost $2,476 (a few big-size losers carry little R).
  const perTrade = (s: TiltGroup["stats"]) => s.totalPL / s.trades;
  const rWorse = a < b;
  const plWorse = perTrade(after.stats) < perTrade(base.stats);
  const size =
    after.sizeVsUsual != null && Math.abs(after.sizeVsUsual - 1) >= 0.15
      ? ` You size ${after.sizeVsUsual > 1 ? "up" : "down"} to ${after.sizeVsUsual.toFixed(1)}x your usual then.`
      : "";
  const figures =
    `${formatR(a)} and ${formatMoney(perTrade(after.stats), { sign: "always" })} a trade after two or more losses in a row, ` +
    `against ${formatR(b)} and ${formatMoney(perTrade(base.stats), { sign: "always" })} otherwise.`;
  if (rWorse && plWorse) {
    return `You trade worse after losing streaks: ${figures} Those trades made ${formatMoney(after.stats.totalPL, { sign: "always" })} in total.${size}`;
  }
  if (!rWorse && !plWorse) return `Losing streaks don't seem to throw you: ${figures}${size}`;
  return `Mixed: ${figures} The R and the dollars disagree, usually because of position size.${size}`;
}

function TiltCard({ tilt }: { tilt: EmotionReport["tilt"] }) {
  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <h2 className={HEADING}>Trading after losses (tilt)</h2>
      {!tilt ? (
        <p className="text-sm text-zinc-500">No trades were opened straight after a loss yet, so there&apos;s nothing to compare.</p>
      ) : (
        <>
          {tiltVerdict(tilt) && <p className="text-sm text-zinc-700 dark:text-zinc-200">{tiltVerdict(tilt)}</p>}
          <div>
            <StatHeader first="Trades opened" />
            {tilt.map((g) => (
              <div key={g.key}>
                <StatRow row={{ emotion: g.label, stats: g.stats, thin: g.thin, href: "" }} link={false} />
                {(g.topEmotion || g.sizeVsUsual != null) && g.stats.trades > 0 && (
                  <p className="-mt-1 pb-2 text-xs text-zinc-500">
                    {g.topEmotion && <>Most often felt: {g.topEmotion}. </>}
                    {g.sizeVsUsual != null && <>Size: {g.sizeVsUsual.toFixed(2)}x your usual.</>}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            A losing streak counts trades that had closed before this one was opened.
          </p>
        </>
      )}
    </Card>
  );
}

function MistakesCard({ mistakes }: { mistakes: EmotionReport["mistakes"] }) {
  if (!mistakes) return null;
  const rows = mistakes.rows;
  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <h2 className={HEADING}>Emotions before mistakes</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Overall, <span className="tnum font-mono">{pct(mistakes.overallRate)}</span> of your closed trades broke a plan
        rule or carry a mistake. By how you felt going in:
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No emotions logged before entering yet.</p>
      ) : (
        <ShowMoreOnPhone count={rows.length} noun="emotions" className="flex flex-col">
          {rows.map((r) => {
            const higher = !r.thin && r.rate > mistakes.overallRate + 0.1;
            return (
              <div
                key={r.emotion}
                className={`flex flex-col gap-0.5 border-b border-zinc-100 py-2 last:border-0 dark:border-subtle sm:flex-row sm:items-baseline sm:gap-3 ${r.thin ? "opacity-60" : ""}`}
              >
                <span className="text-sm text-zinc-900 dark:text-zinc-100 sm:w-40">
                  {r.emotion}
                  {r.thin && <span className="ml-2 text-[11px] text-zinc-500">few trades</span>}
                </span>
                <span className={`tnum font-mono text-sm ${higher ? "text-loss" : "text-zinc-600 dark:text-zinc-400"}`}>
                  {pct(r.rate)} <span className="font-sans text-xs text-zinc-500">({r.withMistake} of {r.trades})</span>
                </span>
                {r.topMistakes.length > 0 && (
                  <span className="text-xs text-zinc-500">
                    Mostly: {r.topMistakes.map((m) => `${m.label} (${m.count})`).join(", ")}
                  </span>
                )}
              </div>
            );
          })}
        </ShowMoreOnPhone>
      )}
    </Card>
  );
}

function OverTimeCard({ periods }: { periods: EmotionReport["periods"] }) {
  if (periods.rows.length === 0) return null;
  return (
    <Card hoverable={false} className="flex flex-col gap-3">
      <h2 className={HEADING}>Emotions over time ({periods.unit === "week" ? "by week" : "by month"})</h2>
      <ShowMoreOnPhone count={periods.rows.length} noun={periods.unit === "week" ? "weeks" : "months"} className="flex flex-col">
        {[...periods.rows].reverse().map((p) => (
          <div
            key={p.key}
            className="flex flex-col gap-1 border-b border-zinc-100 py-2 last:border-0 dark:border-subtle sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="text-sm text-zinc-900 dark:text-zinc-100 sm:w-36">{p.label}</span>
            <span className="tnum font-mono text-xs text-zinc-500 sm:w-28">
              {p.trades} trades · {p.logged} logged
            </span>
            <span className="flex flex-1 flex-wrap gap-1 text-xs">
              {p.topEmotions.length === 0 ? (
                <span className="text-zinc-400">nothing logged</span>
              ) : (
                p.topEmotions.map((e) => (
                  <span key={e.emotion} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    {e.emotion} ×{e.count}
                  </span>
                ))
              )}
            </span>
            <span className={`tnum font-mono text-sm sm:w-28 sm:text-right ${p.totalPL >= 0 ? "text-profit" : "text-loss"}`}>
              {formatMoney(p.totalPL, { sign: "always" })}
            </span>
            <span className="tnum font-mono text-sm text-zinc-600 dark:text-zinc-400 sm:w-16 sm:text-right">
              {formatR(p.expectancy)}
            </span>
          </div>
        ))}
      </ShowMoreOnPhone>
    </Card>
  );
}
