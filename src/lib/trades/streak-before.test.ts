import { describe, expect, it } from "vitest";
import { closedBefore, lossStreakBefore } from "./behaviour";

const t = (id: string, exit: string | null, pl: number) => ({ id, exit_date: exit, dollar_pl: pl });

describe("lossStreakBefore", () => {
  const trades = [
    t("a", "2026-10-01T20:00:00Z", 100),
    t("b", "2026-10-02T20:00:00Z", -50),
    t("c", "2026-10-03T20:00:00Z", -20),
    t("d", "2026-10-05T20:00:00Z", -10), // closed AFTER the entry below
  ];

  it("counts losses that had closed before the entry, newest first, in any input order", () => {
    expect(lossStreakBefore("2026-10-04T14:00:00Z", trades)).toBe(2);
    expect(lossStreakBefore("2026-10-04T14:00:00Z", [...trades].reverse())).toBe(2);
  });

  it("stops at a win or break-even, ignores the trade itself, and is 0 without an entry date", () => {
    expect(lossStreakBefore("2026-10-06T14:00:00Z", [...trades, t("e", "2026-10-05T21:00:00Z", 0)])).toBe(0);
    expect(lossStreakBefore("2026-10-06T14:00:00Z", trades, "d")).toBe(2);
    expect(lossStreakBefore(null, trades)).toBe(0);
  });

  it("lists the trades closed before, newest exit first", () => {
    expect(closedBefore("2026-10-04T14:00:00Z", trades).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});
