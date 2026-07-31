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

  const handlePriceUpdate = useCallback(
    (snapshot: PriceSnapshot) => {
      if (isInvestment || executingRef.current) return;

      const decision = decideAutoExecution(trade, snapshot);
      if (!decision) return;

      executingRef.current = true;
      for (const [key, value] of Object.entries(decision.changes)) {
        updateCoreField(key as EditableCoreField, value);
      }
      void flushNow().finally(() => {
        executingRef.current = false;
      });
      announce(describeAutoExecution(decision));
    },
    [isInvestment, trade, updateCoreField, flushNow, announce],
  );

  return { handlePriceUpdate, autoExecutionMessage: message };
}
