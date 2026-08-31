import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, isPaidUser, type UserPlan } from "./plan";

describe("isPaidUser", () => {
  it("grants access only on an exact 'paid' plan", () => {
    expect(isPaidUser({ plan: "paid" })).toBe(true);
    expect(isPaidUser({ plan: "free" })).toBe(false);
  });

  it("defaults to free, so a user is never paid by omission", () => {
    expect(DEFAULT_PLAN).toBe("free");
    expect(isPaidUser({ plan: DEFAULT_PLAN })).toBe(false);
  });

  // The gate is an equality test against "paid" rather than `!== "free"`
  // precisely so that anything unrecognized denies access. These values can't
  // come from the app (0029's check constraint rejects them, and the column
  // isn't writable by `authenticated` at all), but they can come from a
  // hand-edited row, a pre-migration database, or a future plan tier added to
  // the constraint before this function is taught about it -- and in every one
  // of those cases the answer must be "not paid".
  it("fails closed on any value that isn't exactly 'paid'", () => {
    const unexpected = [
      "Paid",
      "PAID",
      " paid",
      "paid ",
      "premium",
      "trial",
      "",
      null,
      undefined,
      0,
      1,
      true,
    ];

    for (const plan of unexpected) {
      expect(isPaidUser({ plan: plan as unknown as UserPlan })).toBe(false);
    }
  });
});
