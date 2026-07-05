"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditableCoreField, Trade } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 600;

export function useAutosaveTrade(initialTrade: Trade) {
  const [trade, setTrade] = useState<Trade>(initialTrade);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCoreRef = useRef<Partial<Record<EditableCoreField, unknown>>>({});
  const pendingCustomRef = useRef<Record<string, unknown>>({});
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
  // `flush` needs to re-schedule itself on failure, but `schedule` (below)
  // is defined in terms of `flush` -- indirect through a ref rather than a
  // circular useCallback dependency.
  const scheduleRef = useRef<() => void>(() => {});

  const flush = useCallback(async () => {
    const core = pendingCoreRef.current;
    const customFields = pendingCustomRef.current;
    pendingCoreRef.current = {};
    pendingCustomRef.current = {};

    if (Object.keys(core).length === 0 && Object.keys(customFields).length === 0) return;

    const seq = ++requestSeqRef.current;
    for (const key of Object.keys(core) as EditableCoreField[]) coreKeyOwnerRef.current[key] = seq;
    for (const key of Object.keys(customFields)) customKeyOwnerRef.current[key] = seq;
    setStatus("saving");
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core, customFields }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = (await res.json()) as Trade;

      // A later flush already started while this request was in flight --
      // it'll apply its own, fresher response. Applying this stale one now
      // would regress state to a pre-edit value.
      if (seq !== requestSeqRef.current) return;

      // Any key still in pendingCoreRef/pendingCustomRef at this point was
      // typed *during* this request, so `updated` (computed from the
      // pre-keystroke value) is stale for it -- keep the local value
      // (already in `prev`) instead of letting the server response
      // clobber what the user just typed.
      setTrade((prev) => {
        const merged = { ...updated } as Record<string, unknown>;
        for (const key of Object.keys(pendingCoreRef.current) as EditableCoreField[]) {
          merged[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        merged.custom_fields = { ...updated.custom_fields, ...pendingCustomRef.current };
        return merged as unknown as Trade;
      });
      setStatus("saved");
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
      // Newer pending edits win, since they're spread second.
      pendingCoreRef.current = { ...staleCore, ...pendingCoreRef.current };
      pendingCustomRef.current = { ...staleCustom, ...pendingCustomRef.current };
      if (seq === requestSeqRef.current) setStatus("error");
      scheduleRef.current();
    }
  }, [trade.id]);

  const schedule = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

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

  const flushNow = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await flush();
  }, [flush]);

  return { trade, status, updateCoreField, updateCustomField, flushNow };
}
