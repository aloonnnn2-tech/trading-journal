import { describe, expect, it } from "vitest";
import { nextStep, openerOf, placeStep, prevStep, resumeStep, type EngineContext } from "./engine";
import { TOURS, TOUR_STEPS } from "./steps";

// Indexes in the core tour, by what they are.
const LOG_TRADE = 0; // Dashboard, task: open Quick trade
const QUICK_FORM = 1; // inside the form, task: create the trade
const TRADE_HERO = 2; // trade page
const PLAN_ADHERENCE = 3; // trade page
const STRATEGIES = 4;
const HELP = 8; // route-less, the help button

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    pathname: "/dashboard",
    isShown: () => false,
    doneTasks: new Set(),
    tradePath: null,
    ...over,
  };
}

describe("the tour engine", () => {
  it("starts where the user is, or points the way", () => {
    expect(placeStep(TOUR_STEPS, LOG_TRADE, ctx())).toEqual({ index: LOG_TRADE, mode: "here" });
    expect(placeStep(TOUR_STEPS, LOG_TRADE, ctx({ pathname: "/insights" }))).toEqual({ index: LOG_TRADE, mode: "go" });
  });

  it("moves into the form while it is open", () => {
    const open = ctx({ isShown: (id) => id === "quick-ticker" });
    expect(nextStep(TOUR_STEPS, LOG_TRADE, open)).toEqual({ index: QUICK_FORM, mode: "here" });
  });

  it("skipping the tasks with no trade made points the way to Strategies", () => {
    expect(nextStep(TOUR_STEPS, LOG_TRADE, ctx())).toEqual({ index: STRATEGIES, mode: "go" });
  });

  it("Back from Strategies returns to the trade the tour created, never to step 1", () => {
    const after = ctx({ pathname: "/strategies", doneTasks: new Set([LOG_TRADE, QUICK_FORM]), tradePath: "/trades/abc" });
    expect(prevStep(TOUR_STEPS, STRATEGIES, after)).toEqual({ index: PLAN_ADHERENCE, mode: "go" });
    // ...and on that trade's page, Back stays on the page, then stops: the
    // finished tasks are not offered again.
    const onTrade = { ...after, pathname: "/trades/abc" };
    expect(prevStep(TOUR_STEPS, PLAN_ADHERENCE, onTrade)).toEqual({ index: TRADE_HERO, mode: "here" });
    expect(prevStep(TOUR_STEPS, TRADE_HERO, onTrade)).toBeNull();
  });

  it("without a remembered trade, Back from Strategies offers the unfinished task", () => {
    expect(prevStep(TOUR_STEPS, STRATEGIES, ctx({ pathname: "/strategies" }))).toEqual({ index: LOG_TRADE, mode: "go" });
  });

  it("Resume skips finished tasks", () => {
    const done = ctx({ pathname: "/analytics", doneTasks: new Set([LOG_TRADE, QUICK_FORM]), tradePath: "/trades/abc" });
    expect(resumeStep(TOUR_STEPS, LOG_TRADE, done)).toEqual({ index: TRADE_HERO, mode: "go" });
  });

  it("ends after the last step", () => {
    const helpShown = ctx({ isShown: (id) => id === "nav-help" });
    expect(nextStep(TOUR_STEPS, HELP - 1, helpShown)).toEqual({ index: HELP, mode: "here" });
    expect(nextStep(TOUR_STEPS, HELP, helpShown)).toBeNull();
  });

  it("closing the form returns to the step that opened it", () => {
    expect(openerOf(TOUR_STEPS, QUICK_FORM)).toBe(LOG_TRADE);
    expect(openerOf(TOUR_STEPS, STRATEGIES)).toBeNull();
  });

  it("only ever answers 'here' or 'go' -- there is no way to ask for a navigation", () => {
    for (const steps of Object.values(TOURS)) {
      for (let i = 0; i < steps.length; i++) {
        for (const pathname of ["/dashboard", "/strategies", "/trades/abc"]) {
          const m = placeStep(steps, i, ctx({ pathname, tradePath: "/trades/abc", isShown: () => true }));
          if (m) expect(["here", "go"]).toContain(m.mode);
        }
      }
    }
  });
});
