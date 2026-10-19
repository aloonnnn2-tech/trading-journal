import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalRow } from "./proposals";

// Apply re-checks everything against the journal as it is when the button
// is pressed, and writes through the app's own functions.

let rows: Record<string, ProposalRow>;
const finished: { id: string; status: string; outcome: string | null }[] = [];

vi.mock("./proposals", async (orig) => ({
  ...(await orig<typeof import("./proposals")>()),
  getProposal: vi.fn(async (_sb: unknown, id: string) => rows[id] ?? null),
  claimProposal: vi.fn(async (_sb: unknown, id: string, to: string) => {
    if (rows[id]?.status !== "pending") return false;
    rows[id] = { ...rows[id], status: to as ProposalRow["status"] };
    return true;
  }),
  finishProposal: vi.fn(async (_sb: unknown, id: string, status: string, outcome: string | null) => {
    finished.push({ id, status, outcome });
    rows[id] = { ...rows[id], status: status as ProposalRow["status"], outcome };
  }),
}));

let liveTrade: Record<string, unknown>;
const updateTrade = vi.fn();
const directWrites: Record<string, unknown>[] = [];
vi.mock("@/lib/trades/queries", async () => {
  const { TradeConflictError } = await vi.importActual<typeof import("@/lib/trades/queries")>("@/lib/trades/queries");
  return { TradeConflictError, getTrade: vi.fn(async () => structuredClone(liveTrade)), updateTrade: (...a: unknown[]) => updateTrade(...a) };
});
let liveStrategies: string[];
const setTradeStrategies = vi.fn(async () => undefined);
vi.mock("@/lib/strategies/queries", () => ({
  listTradeStrategyIds: vi.fn(async () => liveStrategies),
  setTradeStrategies: (...a: unknown[]) => setTradeStrategies(...(a as [])),
}));
const createGoal = vi.fn(async () => ({}));
vi.mock("@/lib/goals/queries", () => ({ createGoal: (...a: unknown[]) => createGoal(...(a as [])) }));
vi.mock("@/lib/fields/definitions", () => ({
  listFieldDefinitions: vi.fn(async () => [
    { key: "notes", label: "Notes", field_type: "large_notes", strategy_id: null, options: {} },
    { key: "trade_mistakes", label: "Mistakes", field_type: "multi_select", strategy_id: null, options: { choices: ["FOMO entry", "Moved stop"] } },
  ]),
}));

import { applyProposal, dismissProposal } from "./apply-proposal";
import { TradeConflictError } from "@/lib/trades/queries";

const supabase = {
  from: () => ({
    update: (patch: Record<string, unknown>) => ({
      eq: async () => {
        directWrites.push(patch);
        return { error: null };
      },
    }),
  }),
} as never;

function proposal(kind: ProposalRow["kind"], payload: Record<string, unknown>, before: Record<string, unknown> | null = null): ProposalRow {
  return {
    id: "p1",
    user_id: "u1",
    conversation_id: "c1",
    tool_call_id: "call-1",
    kind,
    trade_id: kind === "create_goal" ? null : "t1",
    payload,
    before,
    display: { title: "t", changes: [] },
    status: "pending",
    outcome: null,
    created_at: "",
    resolved_at: null,
  };
}

beforeEach(() => {
  finished.length = 0;
  directWrites.length = 0;
  updateTrade.mockReset();
  setTradeStrategies.mockClear();
  createGoal.mockClear();
  liveTrade = { id: "t1", mode: "trade", custom_fields: { notes: "Original.", trade_mistakes: ["FOMO entry"] } };
  liveStrategies = ["s2"];
});

describe("applyProposal", () => {
  it("fills the field through updateTrade with the shown 'before' as the changed-since check", async () => {
    rows = { p1: proposal("fill_field", { field: "stop_loss", value: 176.5 }, { core: { stop_loss: null } }) };
    const out = await applyProposal(supabase, "u1", "p1");
    expect(updateTrade).toHaveBeenCalledWith(supabase, "t1", { core: { stop_loss: 176.5 } }, { base: { core: { stop_loss: null } } });
    expect(out).toMatchObject({ kind: "done", proposal: { status: "applied" } });
  });

  it("refuses, and says why, when the field was filled in since", async () => {
    rows = { p1: proposal("fill_field", { field: "stop_loss", value: 176.5 }, { core: { stop_loss: null } }) };
    updateTrade.mockRejectedValueOnce(new TradeConflictError([{ scope: "core", key: "stop_loss" }], {} as never));
    const out = await applyProposal(supabase, "u1", "p1");
    expect(out).toMatchObject({ proposal: { status: "stale", outcome: expect.stringMatching(/filled in since/) } });
  });

  it("applies once: a second click changes nothing", async () => {
    rows = { p1: proposal("fill_field", { field: "stop_loss", value: 176.5 }, { core: { stop_loss: null } }) };
    await applyProposal(supabase, "u1", "p1");
    const again = await applyProposal(supabase, "u1", "p1");
    expect(updateTrade).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ proposal: { status: "applied" } });
  });

  it("re-validates the stored payload: a tampered value is not written", async () => {
    rows = { p1: proposal("fill_field", { field: "stop_loss", value: "DROP TABLE" }, { core: { stop_loss: null } }) };
    const out = await applyProposal(supabase, "u1", "p1");
    expect(updateTrade).not.toHaveBeenCalled();
    expect(out).toMatchObject({ proposal: { status: "failed" } });
    rows = { p1: proposal("fill_field", { field: "commission", value: 0 }, { core: {} }) };
    await applyProposal(supabase, "u1", "p1");
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("adds the strategy to the trade's CURRENT ones, keeping changes made since", async () => {
    rows = { p1: proposal("tag_strategy", { strategy_id: "11111111-1111-4111-8111-111111111111" }, { strategy_ids: [] }) };
    liveStrategies = ["s2", "s3"];
    await applyProposal(supabase, "u1", "p1");
    expect(setTradeStrategies).toHaveBeenCalledWith(supabase, "t1", ["s2", "s3", "11111111-1111-4111-8111-111111111111"]);
  });

  it("appends a note to the notes as they are now, touching only that key", async () => {
    rows = { p1: proposal("add_note", { field_key: "notes", text: "Exited early." }, { value: "Original." }) };
    liveTrade.custom_fields = { notes: "Original. Edited since.", trade_mistakes: ["FOMO entry"] };
    await applyProposal(supabase, "u1", "p1");
    expect(directWrites).toEqual([{ custom_fields: { notes: "Original. Edited since.\n\nExited early.", trade_mistakes: ["FOMO entry"] } }]);
    expect(updateTrade).not.toHaveBeenCalled(); // never recomputes P&L
  });

  it("tags a mistake the journal still has; refuses one it no longer does", async () => {
    rows = { p1: proposal("tag_mistake", { label: "Moved stop" }) };
    await applyProposal(supabase, "u1", "p1");
    expect(directWrites[0]).toEqual({ custom_fields: { notes: "Original.", trade_mistakes: ["FOMO entry", "Moved stop"] } });
    rows = { p1: proposal("tag_mistake", { label: "Revenge" }) };
    expect(await applyProposal(supabase, "u1", "p1")).toMatchObject({ proposal: { status: "failed" } });
  });

  it("creates the goal through the goals route's schema and query", async () => {
    rows = {
      p1: proposal("create_goal", {
        goal: { label: "Win more", kind: "aggregate", metric: "win_rate", target: 55, target_direction: "at_least", period: "month" },
      }),
    };
    await applyProposal(supabase, "u1", "p1");
    expect(createGoal).toHaveBeenCalledWith(supabase, "u1", expect.objectContaining({ label: "Win more", metric: "win_rate", target: 55 }));
  });

  it("is not found for an id RLS doesn't show", async () => {
    rows = {};
    expect(await applyProposal(supabase, "u1", "nope")).toEqual({ kind: "not_found" });
  });
});

describe("dismissProposal", () => {
  it("dismisses a pending suggestion, and can't undo an applied one", async () => {
    rows = { p1: proposal("add_note", { field_key: "notes", text: "x" }) };
    expect(await dismissProposal(supabase, "p1")).toMatchObject({ proposal: { status: "dismissed" } });
    rows = { p1: { ...proposal("add_note", { field_key: "notes", text: "x" }), status: "applied" } };
    expect(await dismissProposal(supabase, "p1")).toMatchObject({ proposal: { status: "applied" } });
  });
});
