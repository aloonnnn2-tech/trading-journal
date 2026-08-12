import { describe, it, expect } from "vitest";
import { buildRowFromMapping, deriveStatusAndResult, withDerivedFields, type ImportTarget } from "./import";
import type { FieldDefinition } from "@/lib/fields/types";

describe("buildRowFromMapping", () => {
  const noFields = new Map<string, FieldDefinition>();
  const mapping: Record<string, ImportTarget> = {
    Symbol: "ticker",
    Side: "direction",
    In: "entry_price",
    Skip: "ignore",
  };

  it("maps columns onto core fields", () => {
    const r = buildRowFromMapping({ Symbol: "AAPL", Side: "long", In: "100", Skip: "junk" }, mapping, noFields);
    expect(r.core).toEqual({ ticker: "AAPL", direction: "long", entry_price: 100 });
    expect(r.error).toBeNull();
  });

  it("normalizes enum casing and spacing", () => {
    const r = buildRowFromMapping({ Symbol: "AAPL", Side: "SHORT" }, { Symbol: "ticker", Side: "direction" }, noFields);
    expect(r.core.direction).toBe("short");
  });

  it("treats blank cells as null rather than an error", () => {
    const r = buildRowFromMapping({ Symbol: "AAPL", In: "  " }, { Symbol: "ticker", In: "entry_price" }, noFields);
    expect(r.core.entry_price).toBeNull();
    expect(r.error).toBeNull();
  });

  // A bad cell is reported but the row is still importable -- matching the
  // spec's "show validation errors inline" rather than failing the file.
  it("reports a bad number without dropping the rest of the row", () => {
    const r = buildRowFromMapping({ Symbol: "AAPL", In: "not-a-number" }, { Symbol: "ticker", In: "entry_price" }, noFields);
    expect(r.error).toContain("invalid number");
    expect(r.core.ticker).toBe("AAPL");
  });

  it("flags a row with no ticker to anchor it", () => {
    const r = buildRowFromMapping({ Symbol: "" }, { Symbol: "ticker" }, noFields);
    expect(r.error).toContain("missing ticker");
  });

  it("accepts mode, so a CSV can carry investment trades", () => {
    const r = buildRowFromMapping({ Symbol: "VOO", M: "investment" }, { Symbol: "ticker", M: "mode" }, noFields);
    expect(r.core.mode).toBe("investment");
  });

  // The mapping is client-supplied, and the import route spreads this core
  // object onto the insert after user_id -- so an unrecognised target had to
  // be dropped, not written through.
  it("refuses a target that isn't an editable core field", () => {
    const r = buildRowFromMapping(
      { Symbol: "AAPL", Who: "00000000-0000-0000-0000-000000000000" },
      { Symbol: "ticker", Who: "user_id" as ImportTarget },
      noFields,
    );
    expect(r.core.user_id).toBeUndefined();
    expect(r.error).toContain("unknown column target");
    expect(r.core.ticker).toBe("AAPL");
  });

  it("refuses id and created_at too", () => {
    for (const target of ["id", "created_at", "dollar_pl"]) {
      const r = buildRowFromMapping(
        { Symbol: "AAPL", X: "whatever" },
        { Symbol: "ticker", X: target as ImportTarget },
        noFields,
      );
      expect(r.core[target]).toBeUndefined();
    }
  });
});

describe("deriveStatusAndResult", () => {
  // Imports used to hard-code every row as closed/open, which the trades
  // list rendered as a contradictory pair of badges.
  it("infers closed from an exit price", () => {
    const core = { exit_price: 110 };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).status).toBe("closed");
  });

  it("infers closed from an exit date", () => {
    const core = { exit_date: "2026-07-01T00:00:00Z" };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).status).toBe("closed");
  });

  // The exact pairing this function exists to prevent. Closed on the date
  // alone means no P/L to judge by, and resultFromPL answers "open" to that.
  it("never pairs a closed status with an open result", () => {
    const core = { exit_date: "2026-07-01T00:00:00Z" };
    const out = deriveStatusAndResult(core, withDerivedFields(core));
    expect(out.status).toBe("closed");
    expect(out.result).not.toBe("open");
    expect(out.result).toBe("break_even");
  });

  it("defaults to open with no exit evidence", () => {
    const core = { entry_price: 100 };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).status).toBe("open");
  });

  it("lets an explicitly mapped status win over inference", () => {
    const core = { status: "pending", exit_price: 110 };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).status).toBe("pending");
  });

  it("reads win/loss/break-even off the P&L sign", () => {
    const win = { entry_price: 100, exit_price: 110, shares: 1 };
    expect(deriveStatusAndResult(win, withDerivedFields(win)).result).toBe("win");

    const loss = { entry_price: 100, exit_price: 90, shares: 1 };
    expect(deriveStatusAndResult(loss, withDerivedFields(loss)).result).toBe("loss");

    const flat = { entry_price: 100, exit_price: 100, shares: 1 };
    expect(deriveStatusAndResult(flat, withDerivedFields(flat)).result).toBe("break_even");
  });

  // Commission is netted into dollar_pl, so a thin win that fees erase
  // should import as the loss it actually was.
  it("classifies a fee-eroded win as a loss", () => {
    const core = { entry_price: 100, exit_price: 100.5, shares: 1 };
    const derived = withDerivedFields(core, 5);
    expect(derived.dollar_pl).toBe(-4.5);
    expect(deriveStatusAndResult(core, derived).result).toBe("loss");
  });

  it("stays open when nothing is computable", () => {
    const core = { entry_price: 100 };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).result).toBe("open");
  });

  it("lets an explicitly mapped result win", () => {
    const core = { result: "break_even", entry_price: 100, exit_price: 110, shares: 1 };
    expect(deriveStatusAndResult(core, withDerivedFields(core)).result).toBe("break_even");
  });
});

describe("withDerivedFields", () => {
  it("keeps the original columns and adds the derived ones", () => {
    const out = withDerivedFields({ ticker: "AAPL", entry_price: 100, exit_price: 110, shares: 1 });
    expect(out.ticker).toBe("AAPL");
    expect(out.dollar_pl).toBe(10);
  });

  it("nets the commission it's handed", () => {
    expect(withDerivedFields({ entry_price: 100, exit_price: 110, shares: 1 }, 4).dollar_pl).toBe(6);
  });
});
