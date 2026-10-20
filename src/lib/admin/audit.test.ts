import { describe, expect, it, vi } from "vitest";
import { AUDIT_ACTIONS, auditRow, recordAudit } from "./audit";

describe("auditRow", () => {
  it("keeps who, what, target and small flat facts", () => {
    expect(auditRow({ actorId: "u1", action: "plan_change", target: "u2", detail: { plan: "paid" } })).toEqual({
      actor_id: "u1",
      action: "plan_change",
      target: "u2",
      detail: { plan: "paid" },
    });
  });

  it("drops anything that could carry contents: objects, arrays, long text, odd keys", () => {
    const row = auditRow({
      actorId: "u1",
      action: "account_export",
      detail: {
        rows: 12,
        ok: true,
        note: "x".repeat(65), // long free text: dropped
        trade: { notes: "my secret plan" }, // nested: dropped
        tags: ["a", "b"], // array: dropped
        "Bad Key": "v", // not a simple key: dropped
        nan: Number.NaN, // not finite: dropped
      },
    });
    expect(row.detail).toEqual({ rows: 12, ok: true });
    expect(JSON.stringify(row)).not.toContain("secret");
  });

  it("caps the target and stores no detail when there is none", () => {
    const row = auditRow({ actorId: "u1", action: "admin_page_view", target: "/admin/" + "x".repeat(400) });
    expect(row.target!.length).toBe(200);
    expect(row.detail).toBeNull();
  });

  it("names every action the routes and pages use", () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "admin_page_view",
        "plan_change",
        "analytics_exclusion",
        "review_featured",
        "waitlist_export",
        "waitlist_remove",
        "account_export",
        "account_delete",
        "help_update",
        "help_remove",
      ]),
    );
  });
});

describe("recordAudit", () => {
  it("inserts through the client it's given", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ insert })) } as never;
    await recordAudit({ actorId: "u1", action: "waitlist_remove", target: "w1" }, client);
    expect(insert).toHaveBeenCalledWith({ actor_id: "u1", action: "waitlist_remove", target: "w1", detail: null });
  });

  it("never fails the action it records: a database error or a missing table is swallowed", async () => {
    const failing = { from: () => ({ insert: async () => ({ error: { code: "42P01", message: "relation does not exist" } }) }) } as never;
    await expect(recordAudit({ actorId: "u1", action: "plan_change" }, failing)).resolves.toBeUndefined();
    const throwing = { from: () => ({ insert: async () => { throw new Error("network"); } }) } as never;
    await expect(recordAudit({ actorId: "u1", action: "plan_change" }, throwing)).resolves.toBeUndefined();
  });
});
