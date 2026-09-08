// Separating what the account did from what the trading did.
//
// **The problem this exists to fix.** Account balance conflates three things:
// money deposited, money withdrawn, and money earned. On the journal this was
// built against, $65,466 was deposited against $13,791 of trading profit -- so
// a balance chart shows a steeply rising line that is mostly funding. Any read
// of "am I actually making money trading?" from that line is wrong.
//
// Cumulative R is the answer to that: +55.6R is +55.6R whether the account
// held $45,000 or $450,000. Plotting it beside the balance is the point of the
// feature.
//
// **A withdrawal is not a drawdown.** This is the trap in the obvious
// implementation: paying yourself $5,000 drops the balance, and a drawdown
// measured on the balance would report that as a losing streak. Drawdown here
// is therefore measured on the TRADING curve, and only the percentage is taken
// relative to the account -- because a $6,000 drawdown means something
// different against $45,000 than against $70,000.

export interface EquityEvent {
  /** ISO timestamp: a trade's exit, or a cash movement. */
  at: string;
  /** Realised P&L, for a trade. */
  pl?: number | null;
  /** R multiple, for a trade that recorded one. */
  r?: number | null;
  /** Signed cash movement: positive deposit, negative withdrawal. */
  cash?: number;
}

export interface EquityPoint {
  date: string;
  /** Trading profit only, from zero. What the old chart called "equity". */
  cumulativePL: number;
  /** Trading performance normalised for account size. */
  cumulativeR: number;
  /** Net deposited so far. */
  deposits: number;
  /** deposits + cumulativePL: what the balance actually was. */
  accountEquity: number;
  /** Fall from the TRADING curve's peak, as a negative number. Never moved
   *  by a deposit or a withdrawal. */
  drawdown: number;
  /**
   * The same fall as a share of the account that was at risk when the peak
   * was set. Null when there was no capital recorded at that point -- a
   * percentage of nothing is not zero, it is undefined.
   */
  drawdownPercent: number | null;
}

export interface EquityCurve {
  points: EquityPoint[];
  /** Trading profit, deposits and the resulting balance, at the end. */
  finalPL: number;
  finalR: number;
  netDeposits: number;
  finalEquity: number;
  /** Deepest trading drawdown, and its percentage at the time. */
  maxDrawdown: number;
  maxDrawdownPercent: number | null;
  /** Trades carrying an R multiple, and the total considered -- the R line
   *  and the P&L line do not rest on identical trade sets, and the UI has to
   *  be able to say so. */
  tradesWithR: number;
  trades: number;
}

/**
 * Merges trades and cash movements into one dated series.
 *
 * **Callers must supply trades in a deterministic order.** The sort below is
 * by timestamp and JavaScript's sort is stable, so trades sharing an exit
 * timestamp keep the order they arrive in -- which means the caller's ORDER BY
 * decides it. That is not cosmetic: everything derived from this curve is
 * path-dependent, and reordering ties measurably changes the answer. Measured
 * on the journal this was built against, the same trades ordered by
 * (exit_date, id) produce 23 drawdown episodes with the deepest still open,
 * while an unspecified tie order produces 27 with none open.
 *
 * Every caller in this app orders by `exit_date` then `id`.
 *
 * @param events Trades and cash movements, trades already in a stable order.
 */
export function buildEquityCurve(events: EquityEvent[]): EquityCurve {
  const ordered = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  const points: EquityPoint[] = [];
  let cumulativePL = 0;
  let cumulativeR = 0;
  let deposits = 0;
  let peakPL = 0;
  // The account behind the peak, so a percentage is against capital that was
  // actually at risk rather than against whatever the balance is today.
  let equityAtPeak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent: number | null = null;
  let trades = 0;
  let tradesWithR = 0;

  for (const event of ordered) {
    if (event.cash !== undefined) {
      deposits += event.cash;
    } else {
      cumulativePL += event.pl ?? 0;
      trades += 1;
      if (event.r != null) {
        cumulativeR += event.r;
        tradesWithR += 1;
      }
    }

    const accountEquity = deposits + cumulativePL;

    // The peak is tracked on the trading curve alone, so neither a deposit
    // nor a withdrawal can create or heal a drawdown.
    //
    // `>=` rather than `>` on purpose, for two cases a strict comparison gets
    // wrong. An account that deposits and then loses without ever going into
    // profit sits at cumulativePL 0 == peak 0, so a strict test never records
    // the capital and every percentage comes back null. And a deposit made
    // while at the peak genuinely increases the capital at risk, which the
    // next drawdown should be measured against.
    if (cumulativePL >= peakPL) {
      peakPL = cumulativePL;
      equityAtPeak = accountEquity;
    }

    const drawdown = cumulativePL - peakPL;
    const drawdownPercent = equityAtPeak > 0 ? drawdown / equityAtPeak : null;

    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }

    points.push({
      date: event.at.slice(0, 10),
      cumulativePL,
      cumulativeR,
      deposits,
      accountEquity,
      drawdown,
      drawdownPercent,
    });
  }

  return {
    points,
    finalPL: cumulativePL,
    finalR: cumulativeR,
    netDeposits: deposits,
    finalEquity: deposits + cumulativePL,
    maxDrawdown,
    maxDrawdownPercent,
    tradesWithR,
    trades,
  };
}
