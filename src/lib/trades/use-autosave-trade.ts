"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditableCoreField, Trade } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 600;
const MAX_RETRY_DELAY_MS = 30_000;

// Composite key for strategy-scoped field ownership tracking -- a NUL (\x00)
// can't appear in a strategy id (uuid) or a field key (slug), so it's a
// safe separator that never collides with a real key.
function strategyFieldOwnerKey(strategyId: string, fieldKey: string): string {
  return `${strategyId}\x00${fieldKey}`;
}

// Server response -> local state, keeping anything typed while the request
// was in flight (those keys are still pending, so the response is stale for
// them). Shared by autosave and by applyServerTrade.
function mergeServerTrade(
  prev: Trade,
  updated: Trade,
  pendingCore: Partial<Record<EditableCoreField, unknown>>,
  pendingCustom: Record<string, unknown>,
  pendingStrategy: Record<string, Record<string, unknown>>,
): Trade {
  const merged = { ...updated } as Record<string, unknown>;
  for (const key of Object.keys(pendingCore) as EditableCoreField[]) {
    merged[key] = (prev as unknown as Record<string, unknown>)[key];
  }
  merged.custom_fields = { ...updated.custom_fields, ...pendingCustom };
  const mergedStrategyFieldValues = { ...updated.strategy_field_values };
  for (const strategyId of Object.keys(pendingStrategy)) {
    mergedStrategyFieldValues[strategyId] = {
      ...updated.strategy_field_values[strategyId],
      ...pendingStrategy[strategyId],
    };
  }
  merged.strategy_field_values = mergedStrategyFieldValues;
  return merged as unknown as Trade;
}

export function useAutosaveTrade(initialTrade: Trade) {
  const [trade, setTrade] = useState<Trade>(initialTrade);

  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCoreRef = useRef<Partial<Record<EditableCoreField, unknown>>>({});
  const pendingCustomRef = useRef<Record<string, unknown>>({});
  const pendingStrategyFieldsRef = useRef<Record<string, Record<string, unknown>>>({});
  // Bumped on every dispatched request. Lets a response recognize a newer
  // flush has already started (and will apply its own, fresher response),
  // so it doesn't regress state to a pre-edit value once it lands.
  const requestSeqRef = useRef(0);
  // Which request last "claimed" each key for a round-trip. On failure, a
  // request should only requeue the keys it still owns -- if a later
  // request has since claimed a key (the user edited it again and that
  // edit was already dispatched), requeuing the old value would stomp the
  // newer one; not requeuing it at all would silently drop it if no later
  // request ever touched it.
  const coreKeyOwnerRef = useRef<Partial<Record<EditableCoreField, number>>>({});
  const customKeyOwnerRef = useRef<Record<string, number>>({});
  const strategyFieldOwnerRef = useRef<Record<string, number>>({});
  // Consecutive automatic-retry failures, for backoff. Reset whenever a
  // fresh user edit is scheduled (worth trying at full speed again) or a
  // flush succeeds.
  const retryCountRef = useRef(0);
  // `updated_at` of the last `initialTrade` this hook actually adopted --
  // lets the sync effect below tell "server state moved on externally
  // (e.g. a version-history restore)" apart from "same trade, re-rendered
  // for an unrelated reason."
  const appliedUpdatedAtRef = useRef(initialTrade.updated_at);
  // `flush` needs to re-schedule itself (with backoff) on failure, but
  // referencing the `flush` binding from inside its own body would access
  // it before the `const` assignment completes -- indirect through a ref
  // (kept current below) instead.
  const flushRef = useRef<(isRetry?: boolean) => Promise<void>>(async () => {});

  const flush = useCallback(async (isRetry = false) => {
    const core = pendingCoreRef.current;
    const customFields = pendingCustomRef.current;
    const strategyFieldValues = pendingStrategyFieldsRef.current;
    pendingCoreRef.current = {};
    pendingCustomRef.current = {};
    pendingStrategyFieldsRef.current = {};

    const strategyIds = Object.keys(strategyFieldValues);
    if (Object.keys(core).length === 0 && Object.keys(customFields).length === 0 && strategyIds.length === 0) {
      return;
    }

    const seq = ++requestSeqRef.current;
    for (const key of Object.keys(core) as EditableCoreField[]) coreKeyOwnerRef.current[key] = seq;
    for (const key of Object.keys(customFields)) customKeyOwnerRef.current[key] = seq;
    for (const strategyId of strategyIds) {
      for (const key of Object.keys(strategyFieldValues[strategyId])) {
        strategyFieldOwnerRef.current[strategyFieldOwnerKey(strategyId, key)] = seq;
      }
    }
    // Only flash "Saving..." for a fresh, user-triggered attempt -- a
    // background backoff retry flipping the badge to "saving" and back to
    // "error" every attempt reads as flicker, not a stable "not saved"
    // warning. The badge stays on "error" across retries instead.
    if (!isRetry) setStatus("saving");
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core, customFields, strategyFieldValues }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = (await res.json()) as Trade;

      // A later flush already started while this request was in flight --
      // it'll apply its own, fresher response. Applying this stale one now
      // would regress state to a pre-edit value.
      if (seq !== requestSeqRef.current) return;

      // Any key still pending at this point was typed *during* this
      // request, so `updated` (computed from the pre-keystroke value) is
      // stale for it -- keep the local value (already in `prev`) instead
      // of letting the server response clobber what the user just typed.
      setTrade((prev) => mergeServerTrade(prev, updated, pendingCoreRef.current, pendingCustomRef.current, pendingStrategyFieldsRef.current));
      setStatus("saved");
      retryCountRef.current = 0;
    } catch {
      // Only requeue keys this request still owns -- a key a later request
      // has since claimed (owner seq moved on) is either already being
      // retried by that request or was already saved by it; requeuing it
      // here would either duplicate work or stomp newer data.
      const staleCore: Partial<Record<EditableCoreField, unknown>> = {};
      for (const key of Object.keys(core) as EditableCoreField[]) {
        if (coreKeyOwnerRef.current[key] === seq) staleCore[key] = core[key];
      }
      const staleCustom: Record<string, unknown> = {};
      for (const key of Object.keys(customFields)) {
        if (customKeyOwnerRef.current[key] === seq) staleCustom[key] = customFields[key];
      }
      const staleStrategyFields: Record<string, Record<string, unknown>> = {};
      for (const strategyId of strategyIds) {
        for (const key of Object.keys(strategyFieldValues[strategyId])) {
          if (strategyFieldOwnerRef.current[strategyFieldOwnerKey(strategyId, key)] === seq) {
            (staleStrategyFields[strategyId] ??= {})[key] = strategyFieldValues[strategyId][key];
          }
        }
      }
      // Newer pending edits win, since they're spread second.
      pendingCoreRef.current = { ...staleCore, ...pendingCoreRef.current };
      pendingCustomRef.current = { ...staleCustom, ...pendingCustomRef.current };
      const mergedStale = pendingStrategyFieldsRef.current;
      for (const strategyId of Object.keys(staleStrategyFields)) {
        mergedStale[strategyId] = { ...staleStrategyFields[strategyId], ...mergedStale[strategyId] };
      }
      pendingStrategyFieldsRef.current = mergedStale;
      if (seq === requestSeqRef.current) setStatus("error");

      // Exponential backoff on automatic retries, capped at MAX_RETRY_DELAY_MS
      // -- without this, a persistent failure (offline, expired session)
      // hammers the API every AUTOSAVE_DELAY_MS forever.
      retryCountRef.current += 1;
      const delay = Math.min(AUTOSAVE_DELAY_MS * 2 ** retryCountRef.current, MAX_RETRY_DELAY_MS);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => flushRef.current(true), delay);
    }
  }, [trade.id]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(() => {
    // A fresh, user-triggered edit -- worth trying at full speed again
    // even if we were mid-backoff from a prior failure.
    retryCountRef.current = 0;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => flushRef.current(false), AUTOSAVE_DELAY_MS);
  }, []);

  const updateCoreField = useCallback(
    (key: EditableCoreField, value: unknown) => {
      setTrade((prev) => ({ ...prev, [key]: value }));
      pendingCoreRef.current[key] = value;
      schedule();
    },
    [schedule],
  );

  const updateCustomField = useCallback(
    (key: string, value: unknown) => {
      setTrade((prev) => ({
        ...prev,
        custom_fields: { ...prev.custom_fields, [key]: value },
      }));
      pendingCustomRef.current[key] = value;
      schedule();
    },
    [schedule],
  );

  const updateStrategyField = useCallback(
    (strategyId: string, key: string, value: unknown) => {
      setTrade((prev) => ({
        ...prev,
        strategy_field_values: {
          ...prev.strategy_field_values,
          [strategyId]: { ...prev.strategy_field_values[strategyId], [key]: value },
        },
      }));
      pendingStrategyFieldsRef.current[strategyId] = {
        ...pendingStrategyFieldsRef.current[strategyId],
        [key]: value,
      };
      schedule();
    },
    [schedule],
  );

  const flushNow = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await flush();
  }, [flush]);

  // Adopt a fresh `initialTrade` when the server state moved on externally
  // (e.g. a version-history restore, detected via a changed `updated_at` --
  // a DB trigger bumps it on every update) -- but never while a local edit
  // is unsaved or in flight, or the fresher server snapshot would clobber it.
  useEffect(() => {
    if (initialTrade.updated_at === appliedUpdatedAtRef.current) return;
    const hasPendingEdits =
      Object.keys(pendingCoreRef.current).length > 0 ||
      Object.keys(pendingCustomRef.current).length > 0 ||
      Object.keys(pendingStrategyFieldsRef.current).length > 0;
    if (hasPendingEdits || status === "saving") return;
    appliedUpdatedAtRef.current = initialTrade.updated_at;
    setTrade(initialTrade);
  }, [initialTrade, status]);

  // Best-effort flush of any unsaved edit when the user navigates away
  // (client-side unmount, e.g. "Back to Trades") or leaves the page
  // entirely (tab close, hard nav) -- the 600ms debounce has no other way
  // to catch either, and `keepalive` lets the request outlive the page.
  useEffect(() => {
    function flushPendingOnExit() {
      const core = pendingCoreRef.current;
      const customFields = pendingCustomRef.current;
      const strategyFieldValues = pendingStrategyFieldsRef.current;
      if (
        Object.keys(core).length === 0 &&
        Object.keys(customFields).length === 0 &&
        Object.keys(strategyFieldValues).length === 0
      ) {
        return;
      }
      fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core, customFields, strategyFieldValues }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) return;
          // The most common trigger here is visibilitychange -> "hidden"
          // (a tab switch), after which the page usually keeps running.
          // Without this cleanup, the still-armed debounce timer re-sent
          // the identical payload on return -- a duplicate PATCH and, via
          // the trade_history trigger, a duplicate snapshot per tab switch.
          //
          // Cleared per key, and only where the value is still the one this
          // flush sent: the user may have come back and typed *during* the
          // request, and that newer edit must survive to be saved. On
          // failure (or a torn-down page, where this callback never runs)
          // nothing is cleared, so the debounce retry still has the data --
          // duplicating a save is recoverable, dropping one is not.
          for (const [key, value] of Object.entries(core)) {
            if (pendingCoreRef.current[key as EditableCoreField] === value) {
              delete pendingCoreRef.current[key as EditableCoreField];
            }
          }
          for (const [key, value] of Object.entries(customFields)) {
            if (pendingCustomRef.current[key] === value) delete pendingCustomRef.current[key];
          }
          for (const [strategyId, values] of Object.entries(strategyFieldValues)) {
            const current = pendingStrategyFieldsRef.current[strategyId];
            if (!current) continue;
            for (const [key, value] of Object.entries(values)) {
              if (current[key] === value) delete current[key];
            }
            if (Object.keys(current).length === 0) {
              delete pendingStrategyFieldsRef.current[strategyId];
            }
          }
        })
        .catch(() => {});
    }

    // `visibilitychange`→"hidden" fires reliably when a mobile browser tab
    // is backgrounded (switching apps, locking the screen); `pagehide` often
    // doesn't in that case since the page is frozen/bfcache'd rather than
    // actually unloaded, unlike a desktop tab close or hard nav.
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushPendingOnExit();
    }

    window.addEventListener("pagehide", flushPendingOnExit);
    window.addEventListener("beforeunload", flushPendingOnExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingOnExit);
      window.removeEventListener("beforeunload", flushPendingOnExit);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingOnExit();
    };
  }, [trade.id]);

  // On mobile, losing and regaining connectivity mid-edit is common (flaky
  // signal, moving between wifi/cellular) -- without this, a failed save
  // just waits out the exponential backoff (up to 30s) even after the
  // network is back, instead of retrying as soon as it plausibly can.
  useEffect(() => {
    function handleOnline() {
      if (status !== "error") return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      retryCountRef.current = 0;
      flushRef.current(true);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [status]);

  // A trade saved through another route (e.g. choosing its fee) comes back
  // through the same merge, so nothing being typed is lost.
  const applyServerTrade = useCallback((updated: Trade) => setTrade((prev) => mergeServerTrade(prev, updated, pendingCoreRef.current, pendingCustomRef.current, pendingStrategyFieldsRef.current)), []);

  return { trade, status, updateCoreField, updateCustomField, updateStrategyField, flushNow, applyServerTrade };
}
