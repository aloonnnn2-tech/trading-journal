"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PriceSnapshot } from "@/components/trade-card/PriceChart";
import type { EditableCoreField, Trade } from "./types";
import { decideAutoExecution, describeAutoExecution } from "./auto-execute";

const BANNER_DISMISS_MS = 10_000;

// Watches the live price (via PriceChart's onPriceUpdate) and advances the
// trade when price touches a level that matters:
//   - pending -> open, when price touches the entry level
//   - open -> closed, when price touches the stop loss or take profit
//
// The decision itself lives in `./auto-execute` as a pure function, shared
// with the scheduled background job (`/api/cron/auto-execute`) so both make
// identical calls. This hook is just the browser half: it reacts instantly
// while the page is open, and the job covers everything else. Whichever
// notices first wins; the other then sees a status it no longer acts on.
export function useAutoExecuteTrade(
  trade: Trade,
  isInvestment: boolean,
  updateCoreField: (key: EditableCoreField, value: unknown) => void,
  flushNow: () => Promise<void>,
  /** Takes up the saved trade when it turns out to be ahead of this page. */
  adoptServerTrade?: (saved: Trade) => void,
) {
  const [message, setMessage] = useState<string | null>(null);
  // Guards against a second poll firing mid-flight while the PATCH from the
  // first one hasn't landed yet -- without it, a status flip from
  // "pending" to "open" followed immediately by another poll tick could
  // read stale `trade.status` and double-fire.
  const executingRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Called from the price-update callback below (an event handler, not a
  // render-time effect), so scheduling the auto-dismiss here directly --
  // rather than via a separate useEffect watching the message -- avoids a
  // setState-during-effect cascade for what's fundamentally a one-shot
  // notification, not state synchronized from a dependency.
  const announce = useCallback((text: string) => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setMessage(text);
    dismissTimerRef.current = setTimeout(() => setMessage(null), BANNER_DISMISS_MS);
  }, []);

  // The dismiss timer outlives the component if the user navigates away
  // within the 10s window, leaving a pending setState on an unmounted tree.
  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    [],
  );

  // Depending on the whole `trade` object gave this callback a new identity
  // on every autosave render (autosave returns a fresh object each save),
  // churning PriceChart's onPriceUpdate prop for no behavioral reason. The
  // decision only reads these fields, so they are the dependencies.
  const tradeId = trade.id;
  const {
    mode,
    status,
    direction,
    entry_price,
    stop_loss,
    take_profit,
    entry_date,
    order_type,
    limit_price,
    time_in_force,
  } = trade;
  const handlePriceUpdate = useCallback(
    (snapshot: PriceSnapshot) => {
      if (isInvestment || executingRef.current) return;

      const decision = decideAutoExecution(
        {
          mode,
          status,
          direction,
          entry_price,
          stop_loss,
          take_profit,
          entry_date,
          order_type,
          limit_price,
          time_in_force,
        },
        snapshot,
      );
      if (!decision) return;

      executingRef.current = true;
      // Ask the server first: the background sweep may already have done
      // this while the tab was hidden, and this page's copy is then stale.
      // Applying it anyway raced the sweep and was refused as a conflict
      // (a different fill time), blocking the next edits. Already advanced
      // = nothing to do here; the page re-reads the trade on its own.
      void (async () => {
        try {
          const res = await fetch(`/api/trades/${tradeId}`, { cache: "no-store" });
          const saved = res.ok ? ((await res.json()) as Trade) : null;
          if (saved && saved.status !== status) {
            // Already done elsewhere (the background sweep): take up the
            // saved trade, or this page keeps deciding -- and asking -- on
            // every tick, and its next edit is checked against old values.
            adoptServerTrade?.(saved);
            return;
          }
          for (const [key, value] of Object.entries(decision.changes)) {
            updateCoreField(key as EditableCoreField, value);
          }
          await flushNow();
          announce(describeAutoExecution(decision));
        } finally {
          executingRef.current = false;
        }
      })();
    },
    [
      tradeId,
      isInvestment,
      mode,
      status,
      direction,
      entry_price,
      stop_loss,
      take_profit,
      entry_date,
      order_type,
      limit_price,
      time_in_force,
      updateCoreField,
      flushNow,
      announce,
      adoptServerTrade,
    ],
  );

  return { handlePriceUpdate, autoExecutionMessage: message };
}
