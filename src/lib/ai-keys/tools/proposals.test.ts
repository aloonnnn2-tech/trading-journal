import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./journal";

// The propose_ tools only ever RECORD a suggestion. These pin what they will
// and won't suggest, and that what they record is what the user is shown.

const trade = {
  id: "t1",
  ticker: "AAPL",
  mode: "trade",
  status: "closed",
  result: "win",
  direction: "long",
  entry_price: 180,
  stop_loss: null,
  take_profit: null,
  exit_price: 190,
  entry_date: "2026-10-03T14:00:00Z",
  exit_date: "2026-10-05T14:00:00Z",
  shares: 10,
  order_type: "market",
  created_at: "2026-10-03T14:00:00Z",
  custom_fields: { notes: "Entered on the break.", trade_mistakes: ["FOMO entry"] },
};

const inserted: Record<string, unknown>[] = [];
vi.mock("@/lib/chat/proposals", async (orig) => ({
  ...(await orig<typeof import("@/lib/chat/proposals")>()),
  insertProposal: vi.fn(async (_sb: unknown, input: Record<string, unknown>) => {
    inserted.push(input);
    return { ...input, id: `p${inserted.length}`, status: "pending", outcome: null, created_at: "", resolved_at: null };
  }),
}));
vi.mock("@/lib/trades/queries", () => ({ getTrade: vi.fn(async () => structuredClone(trade)) }));
vi.mock("@/lib/strategies/queries", () => ({
  listStrategies: vi.fn(async () => [
    { id: "s1", name: "Breakout" },
    { id: "s2", name: "Pullback" },
  ]),
  listTradeStrategyIds: vi.fn(async () => ["s2"]),
}));
vi.mock("./journal", async (orig) => ({
  ...(await orig<typeof import("./journal")>()),
  findTrade: vi.fn(async (_store: unknown, ref: { id?: string; ticker?: string }) =>
    ref.id === "t1" || ref.ticker === "AAPL" ? { row: { id: "t1" }, otherMatches: 0, dateMatched: true } : { row: undefined, otherMatches: 0, dateMatched: true },
  ),
}));

import { proposeChange } from "./proposals";

const fields = {
  trade: [
    { key: "notes", label: "Notes", field_type: "large_notes", strategy_id: null, options: {} },
    { key: "trade_mistakes", label: "Mistakes", field_type: "multi_select", strategy_id: null, options: { choices: ["FOMO entry", "Moved stop"] } },
  ],
  investment: [],
  byStrategy: {},
};

function ctx(proposals = true): ToolContext {
  return {
    supabase: { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { hidden_core_fields: [] } }) }) }) } as never,
    timezone: null,
    store: { fields: async () => fields } as never,
    outputBudget: 24_000,
    proposals: proposals ? { conversationId: "c1", userId: "u1", made: 0 } : undefined,
  };
}

beforeEach(() => {
  inserted.length = 0;
});

describe("propose_change", () => {
  it("records a fill for an empty field, says it's NOT saved, and shows exactly what it recorded", async () => {
    const out = (await proposeChange(ctx(), "call-1", { kind: "fill_field", ticker: "AAPL", field: "stop_loss", value: "176.5" })) as Record<string, unknown>;
    expect(out.proposed).toBe(true);
    expect(String(out.note)).toMatch(/NOT saved/);
    expect(inserted[0]).toMatchObject({
      kind: "fill_field",
      tool_call_id: "call-1",
      trade_id: "t1",
      payload: { field: "stop_loss", value: 176.5 },
      before: { core: { stop_loss: null } },
    });
    expect((out.proposal_card as { display: { title: string } }).display.title).toBe("Fill in Stop Loss on AAPL (3 Oct 2026)");
  });

  it("never overwrites: a field with a value is refused", async () => {
    const out = (await proposeChange(ctx(), "c", { kind: "fill_field", ticker: "AAPL", field: "exit_price", value: 200 })) as { error: string };
    expect(out.error).toMatch(/already has a value/);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a value the trade form would refuse", async () => {
    const out = (await proposeChange(ctx(), "c", { kind: "fill_field", ticker: "AAPL", field: "stop_loss", value: "soon" })) as { error: string };
    expect(out.error).toMatch(/isn't a valid Stop Loss/);
  });

  it("tags only an existing strategy, and not one already on the trade", async () => {
    expect(await proposeChange(ctx(), "a", { kind: "tag_strategy", ticker: "AAPL", strategy: "breakout" })).toHaveProperty("proposed", true);
    expect(inserted[0]).toMatchObject({ payload: { strategy_id: "s1" }, before: { strategy_ids: ["s2"] } });
    expect(await proposeChange(ctx(), "b", { kind: "tag_strategy", ticker: "AAPL", strategy: "Pullback" })).toHaveProperty("error");
    expect(await proposeChange(ctx(), "c", { kind: "tag_strategy", ticker: "AAPL", strategy: "Moonshot" })).toHaveProperty("error");
  });

  it("adds a note after what's there, to the main notes field", async () => {
    await proposeChange(ctx(), "n", { kind: "add_note", ticker: "AAPL", text: "Exited early on fear." });
    expect(inserted[0]).toMatchObject({ payload: { field_key: "notes", text: "Exited early on fear." }, before: { value: "Entered on the break." } });
  });

  it("tags only a mistake the journal has, matching its spelling", async () => {
    await proposeChange(ctx(), "m", { kind: "tag_mistake", ticker: "AAPL", mistake: "moved stop" });
    expect(inserted[0]).toMatchObject({ payload: { label: "Moved stop" } });
    expect(await proposeChange(ctx(), "m2", { kind: "tag_mistake", ticker: "AAPL", mistake: "FOMO entry" })).toHaveProperty("error");
    expect(await proposeChange(ctx(), "m3", { kind: "tag_mistake", ticker: "AAPL", mistake: "Revenge" })).toHaveProperty("error");
  });

  it("validates a goal with the goals route's own schema", async () => {
    const ok = await proposeChange(ctx(), "g", {
      kind: "create_goal",
      label: "Win more",
      goal_kind: "aggregate",
      metric: "win_rate",
      target: 55,
      target_direction: "at_least",
      period: "month",
    });
    expect(ok).toHaveProperty("proposed", true);
    expect((inserted[0].display as { changes: { after: string }[] }).changes[0].after).toBe("Win rate: at least 55%");
    const bad = (await proposeChange(ctx(), "g2", { kind: "create_goal", label: "x", goal_kind: "aggregate", target: 1, target_direction: "at_least", period: "month" })) as { error: string };
    expect(bad.error).toMatch(/Not a valid goal/);
  });

  it("can't suggest anything where suggestions aren't on, and stops at five a round", async () => {
    expect(await proposeChange(ctx(false), "x", { kind: "add_note", ticker: "AAPL", text: "hi" })).toHaveProperty("error");
    const c = ctx();
    for (let i = 0; i < 5; i++) expect(await proposeChange(c, `n${i}`, { kind: "add_note", ticker: "AAPL", text: "hi" })).toHaveProperty("proposed");
    expect(await proposeChange(c, "n6", { kind: "add_note", ticker: "AAPL", text: "hi" })).toHaveProperty("error");
  });

  it("asks which trade when it can't tell", async () => {
    expect(await proposeChange(ctx(), "x", { kind: "add_note", text: "hi" })).toHaveProperty("error");
    expect(await proposeChange(ctx(), "y", { kind: "add_note", ticker: "TSLA", text: "hi" })).toHaveProperty("error");
  });
});
