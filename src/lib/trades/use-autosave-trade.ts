"use client";

import { useCallback, useRef, useState } from "react";
import type { EditableCoreField, Trade } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 600;

export function useAutosaveTrade(initialTrade: Trade) {
  const [trade, setTrade] = useState<Trade>(initialTrade);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCoreRef = useRef<Partial<Record<EditableCoreField, unknown>>>({});
  const pendingCustomRef = useRef<Record<string, unknown>>({});

  const flush = useCallback(async () => {
    const core = pendingCoreRef.current;
    const customFields = pendingCustomRef.current;
    pendingCoreRef.current = {};
    pendingCustomRef.current = {};

    if (Object.keys(core).length === 0 && Object.keys(customFields).length === 0) return;

    setStatus("saving");
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ core, customFields }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = (await res.json()) as Trade;
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
      setStatus("error");
    }
  }, [trade.id]);

  const schedule = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
  }, [flush]);

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
