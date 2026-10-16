import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TradeConflictError, updateTrade } from "./queries";
import type { Trade } from "./types";

// Two saves landing together used to each merge into the same old row, and
// the second write silently dropped the first one's custom-field values.
// Writes are now conditional on updated_at; these pin the retry and the
// conflict answer.

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    user_id: "u1",
    mode: "trade",
    ticker: "AAPL",
    status: "open",
    direction: "long",
    entry_price: 100,
    stop_loss: 95,
    shares: 10,
    commission: 0,
    commission_manual: true,
    custom_fields: {},
    strategy_field_values: {},
    updated_at: "2026-10-16T10:00:00.000000+00:00",
    ...overrides,
  } as Trade;
}

/**
 * A database holding one trade. `interfere` runs once, between this save's
 * read and its write -- another tab saving -- and moves updated_at like the
 * real trigger does.
 */
function fakeDb(initial: Trade, interfere?: (row: Trade) => Trade) {
  let row = initial;
  let interfered = false;
  let version = 0;
  const writes: Record<string, unknown>[] = [];
  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          const snapshot = row;
          if (interfere && !interfered) {
            interfered = true;
            row = { ...interfere(row), updated_at: `v${++version}` };
          }
          return { data: snapshot, error: null };
        },
      }),
    }),
    update: (payload: Record<string, unknown>) => ({
      eq: () => ({
        eq: (_col: string, expected: string) => ({
          select: () => ({
            maybeSingle: async () => {
              if (row.updated_at !== expected) return { data: null, error: null };
              row = { ...row, ...payload, updated_at: `v${++version}` } as Trade;
              writes.push(payload);
              return { data: row, error: null };
            },
          }),
        }),
      }),
    }),
  });
  return { client: { from } as unknown as SupabaseClient, current: () => row, writes };
}

describe("updateTrade under concurrent saves", () => {
  it("re-reads and merges again when another save landed in between, so neither is lost", async () => {
    const db = fakeDb(trade({ custom_fields: { notes: "" } }), (row) => ({
      ...row,
      custom_fields: { ...row.custom_fields, emotion_before: ["Calm"] },
    }));
    await updateTrade(db.client, "t1", { customFields: { notes: "held through earnings" } });
    expect(db.current().custom_fields).toEqual({ notes: "held through earnings", emotion_before: ["Calm"] });
    expect(db.writes).toHaveLength(1);
  });

  it("answers a real conflict instead of overwriting: the same field changed elsewhere", async () => {
    const db = fakeDb(trade({ stop_loss: 96 }));
    const attempt = updateTrade(db.client, "t1", { core: { stop_loss: 94 } }, { base: { core: { stop_loss: 95 } } });
    await expect(attempt).rejects.toBeInstanceOf(TradeConflictError);
    await attempt.catch((err: TradeConflictError) => {
      expect(err.fields).toEqual([{ scope: "core", key: "stop_loss" }]);
      expect(err.current.stop_loss).toBe(96);
    });
    expect(db.writes).toHaveLength(0);
  });

  it("saves when the base still matches", async () => {
    const db = fakeDb(trade({ stop_loss: 95 }));
    await updateTrade(db.client, "t1", { core: { stop_loss: 94 } }, { base: { core: { stop_loss: 95 } } });
    expect(db.current().stop_loss).toBe(94);
  });
});
