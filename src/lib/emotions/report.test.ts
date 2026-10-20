import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mistakes/queries", () => ({ buildMistakeTrades: vi.fn() }));

import { buildEmotionReport, type EmotionTrade } from "./report";

let n = 0;
/** A trade entered on `day` (Oct 2026) and closed the same day at 20:00 UTC. */
function trade(day: number, pl: number, before: string[] = [], over: Partial<EmotionTrade> = {}): EmotionTrade {
  n += 1;
  const d = String(day).padStart(2, "0");
  return {
    id: `t${n}`,
    ticker: "AAPL",
    dollar_pl: pl,
    r_multiple: pl / 100,
    entry_date: `2026-10-${d}T14:00:00Z`,
    exit_date: `2026-10-${d}T20:00:00Z`,
    size: 1000,
    emotions: { before, during: [], after: [] },
    intensity: null,
    ...over,
  };
}

describe("buildEmotionReport", () => {
  it("scores each emotion with the engine's numbers and marks thin samples", () => {
    const trades = [
      ...[1, 2, 3, 4, 5].map((d) => trade(d, 100, ["Calm"])),
      trade(6, -100, ["FOMO"]),
      trade(7, -50, ["FOMO"]),
    ];
    const r = buildEmotionReport(trades, null, "UTC");
    const calm = r.byPhase.before.find((x) => x.emotion === "Calm")!;
    const fomo = r.byPhase.before.find((x) => x.emotion === "FOMO")!;
    expect(calm.stats).toMatchObject({ trades: 5, wins: 5, winRate: 1, totalPL: 500, expectancy: 1 });
    expect(calm.thin).toBe(false);
    expect(fomo.stats).toMatchObject({ trades: 2, totalPL: -150, expectancy: -0.75 });
    expect(fomo.thin).toBe(true);
    expect(fomo.href).toBe("/trades?emotion=FOMO");
    expect(r.loggedTrades).toBe(7);
  });

  it("groups trades by the losing streak that had CLOSED before they were opened", () => {
    const trades = [trade(1, -100), trade(2, -100), trade(3, -40), trade(4, 200), trade(5, 50)];
    const r = buildEmotionReport(trades, null, "UTC");
    const by = Object.fromEntries(r.tilt!.map((g) => [g.key, g.stats.trades]));
    // day1: fresh; day2: after 1 loss; day3: after 2; day4: after 3 (2+); day5: after a win.
    expect(by).toEqual({ after_2_losses: 2, after_1_loss: 1, otherwise: 2 });
  });

  it("compares sizing after losses with the usual size", () => {
    const trades = [trade(1, -100), trade(2, -100), trade(3, -40, [], { size: 3000 })];
    const after2 = buildEmotionReport(trades, null, "UTC").tilt!.find((g) => g.key === "after_2_losses")!;
    expect(after2.sizeVsUsual).toBe(3);
  });

  it("buckets intensity and counts logging per period", () => {
    const trades = [trade(1, 100, ["Calm"], { intensity: 2 }), trade(2, -100, [], { intensity: 9 }), trade(3, 50)];
    const r = buildEmotionReport(trades, null, "UTC");
    expect(r.byIntensity.map((b) => [b.emotion, b.stats.trades])).toEqual([
      ["Low (1–3)", 1],
      ["High (7–10)", 1],
    ]);
    expect(r.periods.unit).toBe("week");
    const total = r.periods.rows.reduce((a, p) => a + p.trades, 0);
    const logged = r.periods.rows.reduce((a, p) => a + p.logged, 0);
    expect([total, logged]).toEqual([3, 2]);
  });

  it("links emotions to mistakes against the overall rate", () => {
    const trades = [trade(1, -100, ["FOMO"]), trade(2, -50, ["FOMO"]), trade(3, 100, ["Calm"]), trade(4, 80, ["Calm"])];
    const mistakes = new Map([
      [trades[0].id, ["Chased entry"]],
      [trades[1].id, ["Chased entry", "Moved stop"]],
      [trades[2].id, []],
      [trades[3].id, []],
    ]);
    const r = buildEmotionReport(trades, mistakes, "UTC");
    expect(r.mistakes!.overallRate).toBe(0.5);
    const fomo = r.mistakes!.rows.find((x) => x.emotion === "FOMO")!;
    expect(fomo).toMatchObject({ trades: 2, withMistake: 2, rate: 1 });
    expect(fomo.topMistakes[0]).toEqual({ label: "Chased entry", count: 2 });
  });

  it("says nothing about tilt when no trade followed a loss", () => {
    expect(buildEmotionReport([trade(1, 100), trade(2, 100)], null, "UTC").tilt).toBeNull();
  });
});
