import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { captureRatio } from "@/lib/excursions/calculate";
import type { ExcursionRow } from "@/lib/excursions/queries";

// MAE / MFE and exit efficiency for one trade.
//
// A server component: every figure is either stored or a pure function of
// stored values, so there is nothing to fetch or hold state for.

const STATUS_EXPLANATIONS: Record<string, string> = {
  same_day: "This trade opened and closed on the same day. The only price history available is daily bars, and one bar can't separate what happened while you held from what happened before you entered.",
  no_data: "No daily price history came back for this symbol over the period.",
  no_prices: "An entry or exit price isn't recorded on this trade.",
  no_direction: "Long or short isn't recorded, so there's no way to say which way was in your favour.",
  coarse_data: "The price provider returned bars coarser than daily, which can't measure a hold this short.",
};

function money(value: number | null): string {
  if (value === null) return "—";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function r(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function Figure({
  label,
  price,
  detail,
  tone,
}: {
  label: string;
  price: string;
  detail: string;
  tone?: "good" | "bad";
}) {
  const colour =
    tone === "good" ? "text-profit" : tone === "bad" ? "text-loss" : "text-zinc-900 dark:text-zinc-100";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-sm ${colour}`}>{price}</p>
      <p className="font-mono text-[11px] text-zinc-500">{detail}</p>
    </div>
  );
}

export function TradeExcursionPanel({
  excursion,
  trade,
  isPaid,
}: {
  /** Null when this trade has never been measured. */
  excursion: ExcursionRow | null;
  trade: { entry_price: number | null; exit_price: number | null; direction: string | null };
  isPaid: boolean;
}) {
  if (!isPaid) return null;

  const heading = (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
      Excursion
    </h2>
  );

  if (!excursion) {
    return (
      <Card standalone={false} className="flex flex-col gap-2">
        {heading}
        <p className="text-sm text-zinc-500">
          Not measured yet. Run <strong>Calculate</strong> in the MAE/MFE panel on{" "}
          <Link href="/analytics" className="text-primary hover:underline">
            Analytics
          </Link>{" "}
          to measure every closed trade at once.
        </p>
      </Card>
    );
  }

  if (excursion.status !== "ok") {
    return (
      <Card standalone={false} className="flex flex-col gap-2">
        {heading}
        {/* Always a reason, never a bare "no data". */}
        <p className="text-sm text-zinc-500">
          {STATUS_EXPLANATIONS[excursion.status] ?? "This trade couldn't be measured."}
        </p>
      </Card>
    );
  }

  // Recomputed here rather than stored: it is a pure function of two stored
  // numbers, and captureRatio is the single definition shared with the
  // aggregates on the Analytics page.
  const realised =
    trade.entry_price != null && trade.exit_price != null && trade.direction
      ? trade.direction === "short"
        ? trade.entry_price - trade.exit_price
        : trade.exit_price - trade.entry_price
      : null;
  const mfeMove =
    excursion.mfe_price != null && trade.entry_price != null
      ? trade.direction === "short"
        ? trade.entry_price - excursion.mfe_price
        : excursion.mfe_price - trade.entry_price
      : null;
  const capture = realised === null ? null : captureRatio(realised, mfeMove);

  return (
    <Card standalone={false} className="flex flex-col gap-3">
      {heading}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          label="Worst against you"
          price={money(excursion.mae_price)}
          detail={`${pct(excursion.mae_percent)} · ${r(excursion.mae_r)}`}
          tone="bad"
        />
        <Figure
          label="Best in your favour"
          price={money(excursion.mfe_price)}
          detail={`${pct(excursion.mfe_percent)} · ${r(excursion.mfe_r)}`}
          tone="good"
        />
        <Figure
          label="You exited at"
          price={money(trade.exit_price)}
          detail={realised === null ? "—" : `${realised >= 0 ? "+" : ""}${realised.toFixed(2)} move`}
        />
        <Figure
          label="Captured"
          price={capture === null ? "—" : `${(capture * 100).toFixed(0)}%`}
          detail={capture === null ? "never moved in your favour" : "of the favourable move"}
        />
      </div>

      <p className="text-xs text-zinc-500">
        Measured from {excursion.candles_used} daily bar{excursion.candles_used === 1 ? "" : "s"} of{" "}
        <span className="font-mono">{excursion.symbol}</span>.
        {excursion.includes_partial_days && (
          <>
            {" "}
            The entry and exit days are counted whole, so part of this range may have happened
            before you entered or after you exited. Treat it as an outer bound, not an exact
            figure.
          </>
        )}
      </p>
    </Card>
  );
}
