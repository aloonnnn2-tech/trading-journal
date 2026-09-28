import { describe, expect, it } from "vitest";
import { MIN_SEGMENT_TRADES, MIN_SEGMENT_WITH_R } from "@/lib/segments/engine";
import type { SummaryTrade } from "./queries";
import { buildSummaryFigures, type SummaryFigure } from "./summary-strip";

// The strip's one rule: a figure that can't be given honestly is "—" with a
// reason, never 0. These pin where each figure starts showing and what it
// says when it doesn't.

let seq = 0;
function trade(over: Partial<SummaryTrade> = {}): SummaryTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    dollar_pl: 100,
    r_multiple: 1,
    entry_date: "2026-08-10T13:30:00Z",
    exit_date: "2026-08-10T16:50:00Z",
    ...over,
  };
}

const figure = (figures: SummaryFigure[], key: SummaryFigure["key"]) => figures.find((f) => f.key === key)!;

describe("buildSummaryFigures", () => {
  it("gives the six figures in the strip's order", () => {
    expect(buildSummaryFigures([]).map((f) => f.label)).toEqual([
      "Net P/L",
      "Win rate",
      "Profit factor",
      "Avg hold",
      "Trades",
      "Expectancy",
    ]);
  });

  it("with no closed trades shows every figure as a dash except the count", () => {
    const figures = buildSummaryFigures([]);
    for (const f of figures.filter((f) => f.key !== "trades")) {
      expect(f.value).toBeNull();
      expect(f.reason).toBe("No closed trades match these filters.");
    }
    expect(figure(figures, "trades").value).toBe("0 closed");
  });

  it("below the minimum shows net P/L and the count, and says why the rest are missing", () => {
    const figures = buildSummaryFigures([trade({ dollar_pl: 200 }), trade({ dollar_pl: -50 }), trade({ dollar_pl: 80 })]);
    expect(figure(figures, "netPL")).toMatchObject({ value: "+$230.00", tone: "profit" });
    expect(figure(figures, "trades").value).toBe("3 closed");
    for (const key of ["winRate", "profitFactor"] as const) {
      expect(figure(figures, key).value).toBeNull();
      expect(figure(figures, key).reason).toBe(`Needs at least ${MIN_SEGMENT_TRADES} closed trades; this filter has 3.`);
    }
    expect(figure(figures, "avgHold").reason).toContain("with entry and exit dates; this filter has 3.");
    expect(figure(figures, "expectancy").reason).toBe(
      `Needs at least ${MIN_SEGMENT_WITH_R} closed trades with an R multiple; this filter has 3.`,
    );
  });

  it("at the minimum shows every figure, in the /analytics formats", () => {
    const pls = [300, -100, 200, -100, 50];
    const figures = buildSummaryFigures(pls.map((dollar_pl, i) => trade({ dollar_pl, r_multiple: [1.5, -1, 1, -1, 0.5][i] })));
    expect(figure(figures, "netPL").value).toBe("+$350.00");
    expect(figure(figures, "winRate").value).toBe("60%");
    expect(figure(figures, "profitFactor").value).toBe("2.75");
    expect(figure(figures, "avgHold").value).toBe("3h 20m");
    expect(figure(figures, "trades").value).toBe("5 closed");
    expect(figure(figures, "expectancy").value).toBe("0.20R");
  });

  it("writes a negative expectancy with the same minus as the money figures", () => {
    const figures = buildSummaryFigures(Array.from({ length: 5 }, () => trade({ dollar_pl: -10, r_multiple: -0.11 })));
    expect(figure(figures, "expectancy").value).toBe("−0.11R");
    expect(figure(figures, "netPL").value).toBe("−$50.00");
  });

  it("colours a net loss, and leaves an exact zero uncoloured", () => {
    expect(figure(buildSummaryFigures([trade({ dollar_pl: -40 })]), "netPL")).toMatchObject({ tone: "loss" });
    expect(figure(buildSummaryFigures([trade({ dollar_pl: 0 })]), "netPL").tone).toBeUndefined();
  });

  it("explains a missing profit factor when nothing was lost", () => {
    const figures = buildSummaryFigures(Array.from({ length: 6 }, () => trade({ dollar_pl: 100 })));
    expect(figure(figures, "profitFactor")).toMatchObject({
      value: null,
      reason: "No losing trades in this filter, so there's no loss to divide by.",
    });
  });

  it("counts expectancy's minimum in trades with an R multiple, not trades", () => {
    // Ten trades, four with R: the average would be a four-trade figure.
    const figures = buildSummaryFigures(Array.from({ length: 10 }, (_, i) => trade({ r_multiple: i < 4 ? 1 : null })));
    expect(figure(figures, "winRate").value).toBe("100%");
    expect(figure(figures, "expectancy").value).toBeNull();
    expect(figure(figures, "expectancy").reason).toContain("this filter has 4.");
  });

  it("counts average hold's minimum in trades with both dates", () => {
    const figures = buildSummaryFigures(Array.from({ length: 6 }, (_, i) => trade({ entry_date: i < 2 ? "2026-08-10T13:30:00Z" : null })));
    expect(figure(figures, "avgHold").value).toBeNull();
    expect(figure(figures, "avgHold").reason).toContain("this filter has 2.");
  });

  it("formats a multi-day average hold", () => {
    const figures = buildSummaryFigures(
      Array.from({ length: 5 }, () => trade({ entry_date: "2026-08-10T00:00:00Z", exit_date: "2026-08-14T02:00:00Z" })),
    );
    expect(figure(figures, "avgHold").value).toBe("4d 2h");
  });
});
