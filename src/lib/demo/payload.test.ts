import { describe, expect, it } from "vitest";
import { computeDerivedFields } from "@/lib/trades/compute";
import journal from "./journal.json";
import { buildDemoPayload } from "./payload";

// What seed_demo_journal (0051) is handed. Derived figures come from the
// app's own compute, so a demo trade reads exactly as the app would store it.

describe("buildDemoPayload", () => {
  const payload = buildDemoPayload();

  it("carries every strategy, with ordered rules", () => {
    expect(payload.strategies.map((s) => s.key)).toEqual(journal.strategies.map((s) => s.key));
    for (const s of payload.strategies) s.rules.forEach((r, i) => expect(r.sort_order).toBe(i));
  });

  it("computes each trade's P/L, R and result with the app's own rules", () => {
    for (const t of payload.trades) {
      const derived = computeDerivedFields({ ...(t.row as Record<string, unknown>), commission: null } as never);
      expect(t.row.dollar_pl).toBe(derived.dollar_pl);
      expect(t.row.r_multiple).toBe(derived.r_multiple);
      const pl = t.row.dollar_pl as number;
      expect(t.row.result).toBe(pl > 0 ? "win" : pl < 0 ? "loss" : "break_even");
    }
  });

  it("seeds no commission, so an edit can't recalculate a fee away", () => {
    for (const t of payload.trades) {
      expect(t.row.commission).toBeNull();
      expect(t.row.commission_manual).toBe(false);
    }
  });

  it("dates each row as logged at entry and last touched at exit", () => {
    for (const t of payload.trades) {
      expect(t.row.created_at).toBe(t.row.entry_date);
      expect(t.row.updated_at).toBe(t.row.exit_date);
    }
  });

  it("never names a user or an id -- the database sets both", () => {
    for (const t of payload.trades) {
      expect(t.row).not.toHaveProperty("user_id");
      expect(t.row).not.toHaveProperty("id");
      expect(t.row).not.toHaveProperty("check");
    }
  });

  it("links each trade to its strategy by key, and funds the account", () => {
    expect(payload.trades.every((t) => t.strategies.length === 1)).toBe(true);
    expect(payload.deposit.amount).toBe(journal.account.deposit);
  });
});
