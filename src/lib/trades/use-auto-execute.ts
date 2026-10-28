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
    created_at,
    entry_levels_set_at,
    stop_loss_set_at,
    take_profit_set_at,
  } = trade;

  // When a level was changed ON THIS PAGE. The database stamps the time too
  // (0078), but this page's copy of the trade only sees it after the save
  // round trip -- and a price tick in between would judge the new stop
  // against the day's whole range: the very bug (Alon, 2026-10-28: a stop
  // raised above the entry closed the trade at once). The later of the two
  // times is used.
  const changedHereRef = useRef<{ entry?: string; stop?: string; target?: string }>({});
  const seenRef = useRef<{ entry: string; stop: unknown; target: unknown } | null>(null);
  useEffect(() => {
    const entry = JSON.stringify([entry_price, limit_price, order_type]);
    const seen = seenRef.current;
    if (seen) {
      const nowIso = new Date().toISOString();
      if (seen.entry !== entry) changedHereRef.current.entry = nowIso;
      if (seen.stop !== stop_loss) changedHereRef.current.stop = nowIso;
      if (seen.target !== take_profit) changedHereRef.current.target = nowIso;
    }
    seenRef.current = { entry, stop: stop_loss, target: take_profit };
  }, [entry_price, limit_price, order_type, stop_loss, take_profit]);

  const handlePriceUpdate = useCallback(
    (snapshot: PriceSnapshot) => {
      if (isInvestment || executingRef.current) return;

      const here = changedHereRef.current;
      const later = (a: string | null | undefined, b: string | undefined) =>
        !a ? (b ?? null) : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
      // No minute bars on this page: a level set within the last day is
      // judged on the live price only, and the background sweep (which has
      // the bars) covers what happened between ticks.
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
          created_at,
          entry_levels_set_at: later(entry_levels_set_at, here.entry),
          stop_loss_set_at: later(stop_loss_set_at, here.stop),
          take_profit_set_at: later(take_profit_set_at, here.target),
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
      created_at,
      entry_levels_set_at,
      stop_loss_set_at,
      take_profit_set_at,
      updateCoreField,
      flushNow,
      announce,
      adoptServerTrade,
    ],
  );

  return { handlePriceUpdate, autoExecutionMessage: message };
}
