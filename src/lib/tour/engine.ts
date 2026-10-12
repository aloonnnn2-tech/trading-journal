import type { TourStep } from "./steps";

// Which step comes next or before, and whether it is on this page ("here")
// or the user has to be shown the way there ("go").
//
// Pure, so the rules are tested directly (engine.test.ts). Two rules shape it
// (Alon, 2026-09-29 and 2026-10-07):
//
//  - **The tour never changes the page.** "go" means the card points at the
//    menu item (or, for a trade page, offers a link the user clicks). Nothing
//    here can ask for a navigation, so nothing in the overlay can perform one.
//  - **A finished task is never asked again.** Once the user has opened Quick
//    trade and created a trade, Back and Resume pass over those steps instead
//    of sending them to the Dashboard to "Log your first trade" again.

export interface EngineContext {
  /** The page the user is on. */
  pathname: string;
  /** Whether a data-tour-id target is on screen right now. */
  isShown: (targetId: string) => boolean;
  /** Indexes of task steps the user has completed in this run of the tour. */
  doneTasks: ReadonlySet<number>;
  /** The trade created during this tour, so its page's steps are reachable. */
  tradePath: string | null;
}

export interface Move {
  index: number;
  mode: "here" | "go";
}

/** Whether step `index` can be shown from here, and how. Null: pass it over. */
export function placeStep(steps: readonly TourStep[], index: number, ctx: EngineContext): Move | null {
  const step = steps[index];
  if (!step) return null;
  if (step.action && ctx.doneTasks.has(index)) return null;
  if (step.path) return { index, mode: step.path === ctx.pathname ? "here" : "go" };
  if (step.pathPrefix) {
    if (ctx.pathname.startsWith(step.pathPrefix)) return { index, mode: "here" };
    // A trade page has no menu item; it is reachable only through the trade
    // this tour created, which the card links to.
    return ctx.tradePath?.startsWith(step.pathPrefix) ? { index, mode: "go" } : null;
  }
  // A step with no page of its own (inside the Quick trade form, or the help
  // button) exists only while its target is on screen.
  return ctx.isShown(step.targetId) ? { index, mode: "here" } : null;
}

/** The next step that can be shown, or null when the tour is over. */
export function nextStep(steps: readonly TourStep[], from: number, ctx: EngineContext): Move | null {
  for (let j = from + 1; j < steps.length; j++) {
    const m = placeStep(steps, j, ctx);
    if (m) return m;
  }
  return null;
}

/** The previous step that can be shown, or null when there is none to go back to. */
export function prevStep(steps: readonly TourStep[], from: number, ctx: EngineContext): Move | null {
  for (let j = from - 1; j >= 0; j--) {
    const m = placeStep(steps, j, ctx);
    if (m) return m;
  }
  return null;
}

/** The first step at or after `from` that can be shown: where Resume and a reload land. */
export function resumeStep(steps: readonly TourStep[], from: number, ctx: EngineContext): Move | null {
  return placeStep(steps, from, ctx) ?? nextStep(steps, from, ctx);
}

/**
 * The task step a form-step belongs to: the step whose `done` is this step's
 * target appearing (Quick trade's button, for the form's ticker field).
 * Closing the form without creating anything returns there.
 */
export function openerOf(steps: readonly TourStep[], index: number): number | null {
  const target = steps[index]?.targetId;
  if (!target) return null;
  for (let j = index - 1; j >= 0; j--) {
    const done = steps[j].done;
    if (done && "target" in done && done.target === target) return j;
  }
  return null;
}
