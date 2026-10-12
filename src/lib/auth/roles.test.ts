import { describe, expect, it } from "vitest";
import { getRoles, hasRole, NO_ROLES, rolesFrom } from "./roles";

describe("rolesFrom", () => {
  it("reads the two flags", () => {
    expect(rolesFrom({ plan: "paid", is_admin: true })).toEqual({ paid: true, admin: true });
    expect(rolesFrom({ plan: "free", is_admin: false })).toEqual({ paid: false, admin: false });
  });

  it("fails closed on anything that isn't exactly 'paid' / true", () => {
    for (const plan of ["PAID", "pro", "", null, undefined, 1, true]) {
      expect(rolesFrom({ plan, is_admin: false }).paid, String(plan)).toBe(false);
    }
    for (const is_admin of ["true", 1, null, undefined, "yes"]) {
      expect(rolesFrom({ plan: "free", is_admin }).admin, String(is_admin)).toBe(false);
    }
    expect(rolesFrom(null)).toEqual(NO_ROLES);
  });

  it("keeps paid and admin independent", () => {
    expect(rolesFrom({ plan: "free", is_admin: true })).toEqual({ paid: false, admin: true });
  });
});

describe("hasRole", () => {
  it("every signed-in user has 'user'", () => {
    expect(hasRole(NO_ROLES, "user")).toBe(true);
    expect(hasRole(NO_ROLES, "paid")).toBe(false);
    expect(hasRole({ paid: true, admin: false }, "paid")).toBe(true);
    expect(hasRole({ paid: true, admin: false }, "admin")).toBe(false);
  });
});

describe("getRoles", () => {
  const client = (result: unknown) =>
    ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
    }) as never;

  it("reads the row", async () => {
    expect(await getRoles(client({ data: { plan: "paid", is_admin: false }, error: null }), "u")).toEqual({
      paid: true,
      admin: false,
    });
  });

  it("is NO_ROLES on a query error, a missing row, or a throw", async () => {
    expect(await getRoles(client({ data: null, error: { code: "42703" } }), "u")).toEqual(NO_ROLES);
    expect(await getRoles(client({ data: null, error: null }), "u")).toEqual(NO_ROLES);
    const throwing = { from: () => { throw new Error("boom"); } } as never;
    expect(await getRoles(throwing, "u")).toEqual(NO_ROLES);
  });
});
