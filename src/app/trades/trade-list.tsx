"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { Trade } from "@/lib/trades/types";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/dates/format";
import { TradePanel } from "./trade-panel";
import { ResultBadge } from "./result-badge";

// The trade table and its side panel (Phase 4A of docs/design-audit.md).
//
// Clicking a row -- or its ticker -- opens the trade in a panel on the right
// and adds ?trade=<id> to the list's own URL, through the native History API
// that Next 16 folds into useSearchParams: nothing re-renders on the server
// and the list keeps its filters, sort and scroll. Not the parallel +
// intercepting route the spec suggests: that would also catch the "Add
// trade", screenshot and `n` flows, which router.push to /trades/<id> from
// here and must land on the full editor (Alon chose this, 2026-09-28).
//
// A direct link or refresh of /trades/<id> is still the full page, and a
// modified click on the ticker (new tab, new window) still goes there too.

export function TradeList({
  trades,
  stratNamesByTradeId,
}: {
  trades: Trade[];
  stratNamesByTradeId: Record<string, string[]>;
}) {
  const searchParams = useSearchParams();
  const openId = searchParams.get("trade");
  const order = trades.map((t) => t.id);

  // Whether this page pushed the history entry the panel is on. If it did,
  // closing is a Back (so the browser's Back and Esc do the same thing); if
  // the panel came from a refresh or a shared link, closing replaces the URL
  // instead of leaving the page.
  const pushedRef = useRef(false);
  // The row to hand focus back to when the panel closes.
  const lastOpenRef = useRef<string | null>(null);

  const urlWith = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("trade", id);
      else params.delete("trade");
      const qs = params.toString();
      return qs ? `?${qs}` : window.location.pathname;
    },
    [searchParams],
  );

  const open = useCallback(
    (id: string) => {
      if (openId === id) return;
      if (openId) {
        // Already open: switching trades replaces, so Back still closes.
        window.history.replaceState(null, "", urlWith(id));
      } else {
        window.history.pushState(null, "", urlWith(id));
        pushedRef.current = true;
      }
    },
    [openId, urlWith],
  );

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", urlWith(null));
    }
  }, [urlWith]);

  useEffect(() => {
    if (openId) {
      lastOpenRef.current = openId;
      return;
    }
    // Closed: return focus to the row that was open, so a keyboard user
    // carries on from where they were.
    const last = lastOpenRef.current;
    if (last) {
      document.querySelector<HTMLElement>(`[data-trade-link="${last}"]`)?.focus();
      lastOpenRef.current = null;
    }
    pushedRef.current = false;
  }, [openId]);

  if (trades.length === 0) {
    return (
      <p data-v2-empty className="py-8 text-center text-sm text-zinc-500">
        No trades match your filters.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 dark:border-subtle text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Result</th>
              <th className="px-4 py-3">Tags</th>
              {/* data-num is inert in V1. In V2 it right-aligns the column and
                  gives it the mono, tabular figures a numeric column needs. */}
              <th data-num className="px-4 py-3">Entry Date</th>
              <th data-num className="px-4 py-3">R:R</th>
              <th data-num className="px-4 py-3">Dollar P/L</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const selected = trade.id === openId;
              return (
                <tr
                  key={trade.id}
                  data-selected={selected || undefined}
                  onClick={(e) => {
                    // Leave modified and non-primary clicks to the browser, so
                    // a ctrl/cmd/middle click on the ticker still opens the
                    // full page in a new tab.
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    open(trade.id);
                  }}
                  className={`cursor-pointer border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 ${
                    selected ? "bg-primary/[0.07]" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/trades/${trade.id}`}
                      data-trade-link={trade.id}
                      className="font-mono font-semibold uppercase text-zinc-900 dark:text-zinc-100 hover:text-primary"
                    >
                      {trade.ticker || "Untitled"}
                    </Link>
                    {trade.mode === "investment" && (
                      <span className="ml-2 text-xs text-zinc-500">(Investment)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 capitalize">{trade.status}</td>
                  <td className="px-4 py-3">
                    <ResultBadge result={trade.result} status={trade.status} />
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={stratNamesByTradeId[trade.id] ?? []} />
                  </td>
                  {/* formatDate, not toLocaleDateString(): this is a client
                      component now, and a runtime-locale date renders
                      differently on the server and in the browser -- a
                      hydration mismatch React answers by re-rendering the page.
                      See src/lib/dates/format.ts. */}
                  <td data-num className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {formatDate(trade.entry_date)}
                  </td>
                  {/* Planned reward against planned risk. Unlike P/L it's known
                      before the trade is over, so it's the one number here that
                      says something about a position still open. */}
                  <td data-num className="tnum px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">
                    {trade.risk_reward_ratio != null ? (
                      `${trade.risk_reward_ratio.toFixed(2)}`
                    ) : (
                      <span className="font-sans text-zinc-400 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td data-num className="px-4 py-3">
                    {trade.dollar_pl !== null ? (
                      <span className={`tnum font-mono ${trade.dollar_pl >= 0 ? "text-profit" : "text-loss"}`}>
                        {formatMoney(trade.dollar_pl, { sign: "always" })}
                      </span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && <TradePanel id={openId} order={order} onNavigate={open} onClose={close} />}
    </>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
