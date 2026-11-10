"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditableCoreField, Trade } from "./types";
import type { ConflictField } from "./conflicts";
import { readRefusal, refusedFieldNames, type SaveRefusal } from "./save-refusal";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict" | "refused";

/** Edits the server refused (save-refusal.ts): on screen, not saved, and no
 *  longer being sent. `fields` are the ones to name. */
export interface RefusedEdits {
  message: string;
  fields: string[];
}

/** One request's worth of edits, or the edits set aside after a refusal. */
interface EditSet {
  core: Partial<Record<EditableCoreField, unknown>>;
  custom: Record<string, unknown>;
  strategy: Record<string, Record<string, unknown>>;
}

function isEmpty(edits: EditSet): boolean {
  return (
    Object.keys(edits.core).length === 0 &&
    Object.keys(edits.custom).length === 0 &&
    Object.values(edits.strategy).every((values) => Object.keys(values).length === 0)
  );
}

/** `over` on top of `under`, one level deep for strategy fields. */
function layer(under: EditSet, over: EditSet): EditSet {
  const strategy: Record<string, Record<string, unknown>> = {};
  for (const id of new Set([...Object.keys(under.strategy), ...Object.keys(over.strategy)])) {
    strategy[id] = { ...under.strategy[id], ...over.strategy[id] };
  }
  return { core: { ...under.core, ...over.core }, custom: { ...under.custom, ...over.custom }, strategy };
}

/** A save the server refused because the same field changed elsewhere (409). */
export interface SaveConflict {
  /** The trade as it is saved now. */
  server: Trade;
  fields: ConflictField[];
}

/** Body of every save: the changes, and `base` -- what this page last knew of each changed field. */
function patchBody(
  confirmed: Trade,
  core: Partial<Record<EditableCoreField, unknown>>,
  customFields: Record<string, unknown>,
  strategyFieldValues: Record<string, Record<string, unknown>>,
): string {
  const base = {
    core: Object.fromEntries(
      Object.keys(core).map((key) => [key, (confirmed as unknown as Record<string, unknown>)[key] ?? null]),
    ),
    customFields: Object.fromEntries(Object.keys(customFields).map((key) => [key, confirmed.custom_fields?.[key] ?? null])),
    strategyFieldValues: Object.fromEntries(
      Object.entries(strategyFieldValues).map(([strategyId, values]) => [
        strategyId,
        Object.fromEntries(
          Object.keys(values).map((key) => [key, confirmed.strategy_field_values?.[strategyId]?.[key] ?? null]),
        ),
      ]),
    ),
  };
  return JSON.stringify({ core, customFields, strategyFieldValues, base });
}

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
  // The trade as the server last confirmed it. Each save sends, for every
  // field it changes, the value from here as `base`, so the server can tell
  // "changed in another tab" from "changed by this page" (conflicts.ts).
  const confirmedRef = useRef<Trade>(initialTrade);
  // The save in flight. Saves go one at a time: two in flight could land
  // in either order, and an older value could win.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  // The same, readable inside callbacks without re-creating them.
  const conflictRef = useRef<SaveConflict | null>(null);
  // Edits the server refused. They stay on screen but are in no queue: sent
  // again they would only be refused again, and -- riding in the same request
  // -- take every later edit on the page down with them (save-refusal.ts).
  // Typing in one of them again puts the lot back in the queue; undoRefused()
  // puts the saved values back on screen.
  const setAsideRef = useRef<EditSet>({ core: {}, custom: {}, strategy: {} });
  const [refused, setRefused] = useState<RefusedEdits | null>(null);
  // The fields the refusal is about (`refused.fields`), for callbacks. The
  // rest of what's set aside only travelled with them.
  const refusedNamesRef = useRef<Set<string>>(new Set());

  /** Everything typed here that the server doesn't have: queued or set aside. */
  const unsaved = useCallback(
    (): EditSet =>
      layer(setAsideRef.current, {
        core: pendingCoreRef.current,
        custom: pendingCustomRef.current,
        strategy: pendingStrategyFieldsRef.current,
      }),
    [],
  );

  const flush = useCallback(async (isRetry = false) => {
    // One save at a time: wait for the one in flight, then send whatever is
    // pending by then. Two in flight could land in either order.
    while (inFlightRef.current) await inFlightRef.current;
    // A conflict is waiting for the user's choice: anything sent now would
    // hit the same conflict. resolveConflict() saves afterwards.
    if (conflictRef.current) return;

    const run = (async () => {
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

      // Puts this request's keys back in the queue. Only keys it still
      // owns -- a key a later request has since claimed (owner seq moved
      // on) is either already being retried by that request or was already
      // saved by it; requeuing it here would duplicate work or stomp newer
      // data. Newer pending edits win, since they're spread second.
      const requeue = () => {
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
        pendingCoreRef.current = { ...staleCore, ...pendingCoreRef.current };
        pendingCustomRef.current = { ...staleCustom, ...pendingCustomRef.current };
        const mergedStale = pendingStrategyFieldsRef.current;
        for (const strategyId of Object.keys(staleStrategyFields)) {
          mergedStale[strategyId] = { ...staleStrategyFields[strategyId], ...mergedStale[strategyId] };
        }
        pendingStrategyFieldsRef.current = mergedStale;
      };

      // Only flash "Saving..." for a fresh, user-triggered attempt -- a
      // background backoff retry flipping the badge to "saving" and back to
      // "error" every attempt reads as flicker, not a stable "not saved"
      // warning. The badge stays on "error" across retries instead.
      if (!isRetry) setStatus("saving");
      try {
        const res = await fetch(`/api/trades/${trade.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: patchBody(confirmedRef.current, core, customFields, strategyFieldValues),
        });

        // The same field was changed elsewhere (another tab, the background
        // order check). Never overwrite it silently: keep this edit queued
        // and let the user choose. No automatic retry -- it would only
        // conflict again.
        if (res.status === 409) {
          const body = (await res.json().catch(() => null)) as { trade?: Trade; conflict?: ConflictField[] } | null;
          requeue();
          if (body?.trade) {
            const next = { server: body.trade, fields: body.conflict ?? [] };
            conflictRef.current = next;
            setConflict(next);
            setStatus("conflict");
            return;
          }
          throw new Error("Save conflicted");
        }

        if (!res.ok) {
          // Refused, not failed: this request can never pass, so no retry.
          const refusal: SaveRefusal | null = readRefusal(await res.json().catch(() => null));
          if (!refusal) throw new Error("Save failed");

          // Set this request's edits aside -- except any typed again while it
          // was out: that newer value is queued and still to be tried.
          const aside = setAsideRef.current;
          for (const key of Object.keys(core) as EditableCoreField[]) {
            if (coreKeyOwnerRef.current[key] === seq && !(key in pendingCoreRef.current)) aside.core[key] = core[key];
          }
          for (const key of Object.keys(customFields)) {
            if (customKeyOwnerRef.current[key] === seq && !(key in pendingCustomRef.current)) {
              aside.custom[key] = customFields[key];
            }
          }
          for (const strategyId of strategyIds) {
            for (const key of Object.keys(strategyFieldValues[strategyId])) {
              const typedAgain = key in (pendingStrategyFieldsRef.current[strategyId] ?? {});
              if (strategyFieldOwnerRef.current[strategyFieldOwnerKey(strategyId, key)] === seq && !typedAgain) {
                (aside.strategy[strategyId] ??= {})[key] = strategyFieldValues[strategyId][key];
              }
            }
          }
          if (isEmpty(aside)) return;
          const names = [
            ...Object.keys(aside.core),
            ...Object.keys(aside.custom),
            ...Object.values(aside.strategy).flatMap((values) => Object.keys(values)),
          ];
          const fields = refusedFieldNames(names, refusal);
          refusedNamesRef.current = new Set(fields);
          setRefused({ message: refusal.message, fields });
          setStatus("refused");
          retryCountRef.current = 0;
          return;
        }
        const updated = (await res.json()) as Trade;
        confirmedRef.current = updated;

        // A later flush already started while this request was in flight --
        // it'll apply its own, fresher response. Applying this stale one now
        // would regress state to a pre-edit value.
        if (seq !== requestSeqRef.current) return;

        // Any key still pending at this point was typed *during* this
        // request, so `updated` (computed from the pre-keystroke value) is
        // stale for it -- keep the local value (already in `prev`) instead
        // of letting the server response clobber what the user just typed.
        const held = unsaved();
        setTrade((prev) => mergeServerTrade(prev, updated, held.core, held.custom, held.strategy));
        // Another edit saving doesn't make the refused one saved.
        setStatus(isEmpty(setAsideRef.current) ? "saved" : "refused");
        retryCountRef.current = 0;
      } catch {
        requeue();
        if (seq === requestSeqRef.current) setStatus("error");

        // Exponential backoff on automatic retries, capped at MAX_RETRY_DELAY_MS
        // -- without this, a persistent failure (offline, expired session)
        // hammers the API every AUTOSAVE_DELAY_MS forever.
        retryCountRef.current += 1;
        const delay = Math.min(AUTOSAVE_DELAY_MS * 2 ** retryCountRef.current, MAX_RETRY_DELAY_MS);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => flushRef.current(true), delay);
      }
    })();

    inFlightRef.current = run;
    try {
      await run;
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null;
    }
  }, [trade.id, unsaved]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /**
   * Called for every edit, before it is queued. Editing a field the refusal
   * was about is the user fixing it: everything set aside goes back in the
   * queue, behind the new value, to be tried again. Editing a field that only
   * travelled with it just takes that one out of the set -- the new value
   * saves on its own, and the refused field must not ride along with it.
   */
  const reviveSetAside = useCallback((isHere: (aside: EditSet) => boolean, name: string, drop: (aside: EditSet) => void) => {
    const aside = setAsideRef.current;
    if (!isHere(aside)) return;
    if (refusedNamesRef.current.has(name)) {
      pendingCoreRef.current = { ...aside.core, ...pendingCoreRef.current };
      pendingCustomRef.current = { ...aside.custom, ...pendingCustomRef.current };
      for (const [strategyId, values] of Object.entries(aside.strategy)) {
        pendingStrategyFieldsRef.current[strategyId] = { ...values, ...pendingStrategyFieldsRef.current[strategyId] };
      }
      setAsideRef.current = { core: {}, custom: {}, strategy: {} };
    } else {
      drop(aside);
    }
    if (isEmpty(setAsideRef.current)) {
      refusedNamesRef.current = new Set();
      setRefused(null);
    }
  }, []);

  /**
   * The value to work other fields out from: the saved one while this field
   * is set aside. A share count the server refused is still on screen, and a
   * stop moved meanwhile must not save a risk amount worked out from it.
   */
  const savedIfRefused = useCallback(<T,>(key: EditableCoreField, onScreen: T): T => {
    if (!(key in setAsideRef.current.core)) return onScreen;
    return (confirmedRef.current as unknown as Record<string, T>)[key];
  }, []);

  /** Puts the saved values back on screen for everything set aside. */
  const undoRefused = useCallback(() => {
    const aside = setAsideRef.current;
    if (isEmpty(aside)) return;
    const saved = confirmedRef.current;
    setTrade((prev) => {
      const next = { ...prev } as Record<string, unknown>;
      for (const key of Object.keys(aside.core)) next[key] = (saved as unknown as Record<string, unknown>)[key];
      const custom = { ...prev.custom_fields };
      for (const key of Object.keys(aside.custom)) custom[key] = saved.custom_fields?.[key];
      next.custom_fields = custom;
      const strategy = { ...prev.strategy_field_values };
      for (const [strategyId, values] of Object.entries(aside.strategy)) {
        strategy[strategyId] = { ...strategy[strategyId] };
        for (const key of Object.keys(values)) strategy[strategyId][key] = saved.strategy_field_values?.[strategyId]?.[key];
      }
      next.strategy_field_values = strategy;
      return next as unknown as Trade;
    });
    setAsideRef.current = { core: {}, custom: {}, strategy: {} };
    refusedNamesRef.current = new Set();
    setRefused(null);
    setStatus("idle");
  }, []);

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
      reviveSetAside((aside) => key in aside.core, key, (aside) => delete aside.core[key]);
      pendingCoreRef.current[key] = value;
      schedule();
    },
    [schedule, reviveSetAside],
  );

  const updateCustomField = useCallback(
    (key: string, value: unknown) => {
      setTrade((prev) => ({
        ...prev,
        custom_fields: { ...prev.custom_fields, [key]: value },
      }));
      reviveSetAside((aside) => key in aside.custom, key, (aside) => delete aside.custom[key]);
      pendingCustomRef.current[key] = value;
      schedule();
    },
    [schedule, reviveSetAside],
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
      reviveSetAside(
        (aside) => key in (aside.strategy[strategyId] ?? {}),
        key,
        (aside) => delete aside.strategy[strategyId][key],
      );
      pendingStrategyFieldsRef.current[strategyId] = {
        ...pendingStrategyFieldsRef.current[strategyId],
        [key]: value,
      };
      schedule();
    },
    [schedule, reviveSetAside],
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
    // Set-aside edits count: they are on screen and not saved.
    const hasPendingEdits =
      Object.keys(pendingCoreRef.current).length > 0 ||
      Object.keys(pendingCustomRef.current).length > 0 ||
      Object.keys(pendingStrategyFieldsRef.current).length > 0 ||
      !isEmpty(setAsideRef.current);
    if (hasPendingEdits || status === "saving") return;
    appliedUpdatedAtRef.current = initialTrade.updated_at;
    confirmedRef.current = initialTrade;
    setTrade(initialTrade);
  }, [initialTrade, status]);

  // A page left open in a background tab (or on a phone) does not know that
  // the background sweep filled its order meanwhile. Its next edit was then
  // checked against the old values and refused -- for a stop-limit, the fill
  // price typed straight after the buy (Alon, 2026-10-17). So when the tab
  // comes back into view, re-read the trade and adopt it, the same way a
  // fresh server render is adopted above: never over an unsaved edit, a save
  // in flight, or a conflict waiting for an answer.
  useEffect(() => {
    let cancelled = false;
    // visibilitychange and focus usually fire together on a return: one read.
    let refreshing = false;
    async function refreshIfIdle() {
      if (document.visibilityState !== "visible" || refreshing) return;
      const idle = () =>
        Object.keys(pendingCoreRef.current).length === 0 &&
        Object.keys(pendingCustomRef.current).length === 0 &&
        Object.keys(pendingStrategyFieldsRef.current).length === 0 &&
        isEmpty(setAsideRef.current) &&
        !inFlightRef.current &&
        !conflictRef.current;
      if (!idle()) return;
      refreshing = true;
      try {
        const res = await fetch(`/api/trades/${trade.id}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const fresh = (await res.json()) as Trade;
        // Checked again: the user may have typed while the read was out.
        if (!idle() || fresh.updated_at === confirmedRef.current.updated_at) return;
        appliedUpdatedAtRef.current = fresh.updated_at;
        confirmedRef.current = fresh;
        setTrade(fresh);
      } catch {
        // Offline: the next save's conflict check still protects the data.
      } finally {
        refreshing = false;
      }
    }
    document.addEventListener("visibilitychange", refreshIfIdle);
    window.addEventListener("focus", refreshIfIdle);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshIfIdle);
      window.removeEventListener("focus", refreshIfIdle);
    };
  }, [trade.id]);

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
        // With `base` like every save: a page closed on a conflicting edit
        // loses that edit rather than overwriting the other change unseen.
        // On a tab switch (the common case) nothing is cleared on failure,
        // so the edit is retried and the conflict shown on return.
        body: patchBody(confirmedRef.current, core, customFields, strategyFieldValues),
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
  const applyServerTrade = useCallback(
    (updated: Trade) => {
      confirmedRef.current = updated;
      const held = unsaved();
      setTrade((prev) => mergeServerTrade(prev, updated, held.core, held.custom, held.strategy));
    },
    [unsaved],
  );

  /**
   * The user's answer to a conflict. "mine": save this page's edits over
   * the other change. "theirs": drop this page's edits to the conflicting
   * fields and show the saved version; any other pending edit still saves.
   */
  const resolveConflict = useCallback(
    (choice: "mine" | "theirs") => {
      const current = conflictRef.current;
      if (!current) return;
      if (choice === "theirs") {
        for (const field of current.fields) {
          if (field.scope === "strategy") delete pendingStrategyFieldsRef.current[field.strategyId]?.[field.key];
          else if (field.scope === "core") delete pendingCoreRef.current[field.key as EditableCoreField];
          else delete pendingCustomRef.current[field.key];
        }
      }
      // Either way the saved version is now what this page has seen, so the
      // next save's `base` matches it: "mine" goes through, "theirs" has
      // nothing left to conflict over.
      confirmedRef.current = current.server;
      conflictRef.current = null;
      setConflict(null);
      const held = unsaved();
      setTrade((prev) => mergeServerTrade(prev, current.server, held.core, held.custom, held.strategy));
      setStatus(isEmpty(setAsideRef.current) ? "idle" : "refused");
      void flushRef.current(false);
    },
    [unsaved],
  );

  return {
    trade,
    status,
    conflict,
    refused,
    updateCoreField,
    updateCustomField,
    updateStrategyField,
    flushNow,
    applyServerTrade,
    resolveConflict,
    undoRefused,
    savedIfRefused,
  };
}
