import { describe, expect, it, vi } from "vitest";

// A forced database error must never reach the response (security gaps
// pass, 3.4). The DB error below carries the kind of detail Postgres and
// PostgREST really return: a table, a column, a constraint and a hint.
const DB_ERROR = {
  code: "42703",
  message: 'column trades.secret_internal_col does not exist',
  details: "Failing row contains (…)",
  hint: "Perhaps you meant to reference the column \"trades.dollar_pl\".",
};

vi.mock("@/lib/observability/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  currentRequestId: vi.fn(async () => "req-123"),
}));

// The recalculate route, end to end, with its database update failing.
vi.mock("@/lib/supabase/auth", () => ({ getUserIdFromHeader: vi.fn(async () => "u1") }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: DB_ERROR }) }) }),
  })),
}));
vi.mock("@/lib/supabase/fetch-all", () => ({
  fetchAllRows: vi.fn(async () => [
    { id: "t1", status: "closed", mode: "trade", direction: "long", entry_price: 10, exit_price: 11, shares: 1, commission_manual: false },
  ]),
}));
vi.mock("@/lib/commissions/queries", () => ({ listCommissionRules: vi.fn(async () => []) }));
vi.mock("@/lib/tracking/log", () => ({ logEvent: vi.fn(), SERVER_SESSION_ID: "s" }));

import { SERVER_ERROR_MESSAGE, safeFailureMessage, serverError } from "./server-error";
import { log } from "@/lib/observability/log";
import { POST as recalculate } from "@/app/api/commission-rules/recalculate/route";

const leaks = (text: string) => /secret_internal_col|42703|Failing row|Perhaps you meant|trades\./.test(text);

describe("serverError", () => {
  it("answers with the generic message and the request id, and logs the detail", async () => {
    const res = await serverError("thing.failed", DB_ERROR);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: SERVER_ERROR_MESSAGE, requestId: "req-123" });
    expect(leaks(JSON.stringify(body))).toBe(false);
    expect(log.error).toHaveBeenCalledWith("thing.failed", expect.objectContaining({ error: DB_ERROR }));
  });

  it("safeFailureMessage hides the same detail inside a 200 result", () => {
    expect(leaks(safeFailureMessage("x", DB_ERROR))).toBe(false);
  });
});

describe("a forced database error in a real route", () => {
  it("commission recalculation reports the failure without the database's own words", async () => {
    const res = await recalculate();
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"failed":1');
    expect(leaks(text)).toBe(false);
  });
});
