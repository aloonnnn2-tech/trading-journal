/**
 * User A calls the real route handlers with user B's record ids.
 *
 * Everything below the route is real: the handler, its library calls, the
 * DEV database, RLS, the triggers. Only the glue above it is replaced --
 * src/proxy.ts turns the session cookie into `x-user-id`, and
 * `createClient()` turns the cookie into a database client carrying the
 * user's JWT. Here both come straight from the signed-in test user. (The
 * proxy's own header handling is covered by src/proxy.test.ts.)
 *
 * Each case is aimed twice:
 *   - at B's record  -> must be 403/404, must not echo B's data, and B's row
 *                       must be byte-for-byte unchanged afterwards;
 *   - at A's record  -> must succeed. That is the control: it proves the
 *                       request was valid, so the refusal above was about
 *                       ownership and not a malformed body.
 * Deleting cases run their control last, after everything else has used
 * A's records.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWorld, destroyWorld, snapshot, TINY_PNG, type TestUser } from "./world";

const acting = vi.hoisted(() => ({ userId: "", token: "" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(acting.userId ? { "x-user-id": acting.userId } : {}),
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));
vi.mock("@/lib/supabase/server", async () => {
  const { clientFor } = await import("./world");
  return { createClient: async () => clientFor(acting.token) };
});

let A: TestUser;
let B: TestUser;

beforeAll(async () => {
  ({ A, B } = await createWorld());
});
afterAll(async () => {
  await destroyWorld(A, B);
});

function as(user: TestUser) {
  acting.userId = user.id;
  acting.token = user.accessToken;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  method: string,
  params: Record<string, string>,
  body?: unknown,
  query = "",
): Promise<Response> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const req = new Request(`http://localhost/api/idor${query}`, init);
  return handler(req, { params: Promise.resolve(params) });
}

/** Asserts a refusal that reveals nothing about B's record. */
async function expectRefused(res: Response) {
  const text = await res.text();
  expect([403, 404], `status ${res.status}: ${text.slice(0, 200)}`).toContain(res.status);
  expect(text).not.toContain(B.journal.marker);
  for (const id of Object.values(B.journal)) expect(text).not.toContain(id);
}

async function expectOk(res: Response) {
  const text = await res.text();
  expect(res.status, `control failed ${res.status}: ${text.slice(0, 300)}`).toBeLessThan(300);
}

interface Case {
  name: string;
  load: () => Promise<{ [m: string]: unknown }>;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params: (owner: TestUser) => Record<string, string>;
  body?: (owner: TestUser) => unknown;
  query?: (owner: TestUser) => string;
  /** B's row that must be unchanged after the attack. */
  guard?: (owner: TestUser) => [table: string, column: string, value: string];
  /** Control deletes A's record, so it runs after every other case. */
  deletes?: boolean;
  /** No safe control (e.g. would call a real AI provider). */
  noControl?: string;
}

const id = (u: TestUser) => ({ id: u.journal.tradeId });
const tradeGuard = (u: TestUser): [string, string, string] => ["trades", "id", u.journal.tradeId];

const CASES: Case[] = [
  // ---- one trade
  { name: "GET trades/[id]/panel", load: () => import("@/app/api/trades/[id]/panel/route"), method: "GET", params: id },
  { name: "GET trades/[id]/history", load: () => import("@/app/api/trades/[id]/history/route"), method: "GET", params: id },
  { name: "GET trades/[id]/export", load: () => import("@/app/api/trades/[id]/export/route"), method: "GET", params: id },
  {
    name: "PATCH trades/[id]",
    load: () => import("@/app/api/trades/[id]/route"),
    method: "PATCH",
    params: id,
    body: () => ({ core: { company_name: "edited" } }),
    guard: tradeGuard,
  },
  {
    name: "POST trades/[id]/duplicate",
    load: () => import("@/app/api/trades/[id]/duplicate/route"),
    method: "POST",
    params: id,
    guard: tradeGuard,
  },
  {
    name: "POST trades/[id]/fill-confirmed",
    load: () => import("@/app/api/trades/[id]/fill-confirmed/route"),
    method: "POST",
    params: id,
    guard: tradeGuard,
    noControl: "only acts on a trade whose order just filled (0063); the world's trades never were",
  },
  {
    name: "PUT trades/[id]/fee",
    load: () => import("@/app/api/trades/[id]/fee/route"),
    method: "PUT",
    params: id,
    body: () => ({ fee: "none" }),
    guard: tradeGuard,
  },
  {
    name: "PUT trades/[id]/folders",
    load: () => import("@/app/api/trades/[id]/folders/route"),
    method: "PUT",
    params: id,
    body: (u) => ({ folderIds: [u.journal.folderId] }),
    guard: (u) => ["trade_folders", "trade_id", u.journal.tradeId],
  },
  {
    name: "PUT trades/[id]/strategies",
    load: () => import("@/app/api/trades/[id]/strategies/route"),
    method: "PUT",
    params: id,
    body: (u) => ({ strategyIds: [u.journal.strategyId] }),
    guard: (u) => ["trade_strategies", "trade_id", u.journal.tradeId],
  },
  {
    name: "POST trades/[id]/suggestions",
    load: () => import("@/app/api/trades/[id]/suggestions/route"),
    method: "POST",
    params: id,
    body: () => ({ label: "Moved stop", action: "dismiss" }),
    guard: tradeGuard,
  },
  {
    name: "POST trades/[id]/history/[historyId]/restore",
    load: () => import("@/app/api/trades/[id]/history/[historyId]/restore/route"),
    method: "POST",
    params: (u) => ({ id: u.journal.tradeId, historyId: u.journal.historyId }),
    guard: tradeGuard,
  },
  {
    name: "POST trades/[id]/images",
    load: () => import("@/app/api/trades/[id]/images/route"),
    method: "POST",
    params: id,
    body: () => {
      const fd = new FormData();
      fd.set("file", new File([TINY_PNG], "x.png", { type: "image/png" }));
      return fd;
    },
    guard: (u) => ["trade_images", "trade_id", u.journal.tradeId],
  },
  // ---- AI (paid) -- refused before any provider is called
  {
    name: "POST ai-reviews/trade (B's trade, A's key)",
    load: () => import("@/app/api/ai-reviews/trade/route"),
    method: "POST",
    params: () => ({}),
    body: (u) => ({ tradeId: u.journal.tradeId, keyId: A.journal.keyId }),
    noControl: "would call a real AI provider",
  },
  {
    name: "GET chat/conversations/[id]",
    load: () => import("@/app/api/chat/conversations/[id]/route"),
    method: "GET",
    params: (u) => ({ id: u.journal.conversationId }),
  },
  {
    name: "PATCH chat/conversations/[id]",
    load: () => import("@/app/api/chat/conversations/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.conversationId }),
    body: () => ({ title: "renamed" }),
    guard: (u) => ["ai_conversations", "id", u.journal.conversationId],
  },
  {
    name: "POST chat/conversations/[id]/turn",
    load: () => import("@/app/api/chat/conversations/[id]/turn/route"),
    method: "POST",
    params: (u) => ({ id: u.journal.conversationId }),
    body: () => ({ mode: "send", message: "hello" }),
    guard: (u) => ["ai_messages", "conversation_id", u.journal.conversationId],
    noControl: "would call a real AI provider",
  },
  {
    name: "PATCH ai-keys/[id]",
    load: () => import("@/app/api/ai-keys/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.keyId }),
    body: () => ({ is_active: false }),
    guard: (u) => ["user_api_keys", "id", u.journal.keyId],
  },
  {
    name: "POST ai-keys/[id]/test",
    load: () => import("@/app/api/ai-keys/[id]/test/route"),
    method: "POST",
    params: (u) => ({ id: u.journal.keyId }),
    guard: (u) => ["user_api_keys", "id", u.journal.keyId],
    noControl: "would call a real AI provider",
  },
  // ---- settings-type records
  {
    name: "PATCH commission-rules/[id]",
    load: () => import("@/app/api/commission-rules/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.commissionRuleId }),
    body: () => ({ name: "renamed" }),
    guard: (u) => ["commission_rules", "id", u.journal.commissionRuleId],
  },
  {
    name: "PATCH field-definitions/[id]",
    load: () => import("@/app/api/field-definitions/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.fieldId }),
    body: () => ({ label: "renamed" }),
    guard: (u) => ["field_definitions", "id", u.journal.fieldId],
  },
  {
    name: "PATCH goals/[id]",
    load: () => import("@/app/api/goals/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.goalId }),
    body: () => ({
      label: "renamed",
      kind: "aggregate",
      metric: "trade_count",
      target: 6,
      target_direction: "at_least",
      period: "month",
    }),
    guard: (u) => ["goals", "id", u.journal.goalId],
  },
  {
    name: "PATCH strategies/[id]",
    load: () => import("@/app/api/strategies/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.strategyId }),
    body: () => ({ name: "renamed" }),
    guard: (u) => ["strategies", "id", u.journal.strategyId],
  },
  {
    name: "PATCH strategy-rules/[id]",
    load: () => import("@/app/api/strategy-rules/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.ruleId }),
    body: () => ({ label: "renamed", subject_source: "core", subject_key: "shares", operator: "is_set" }),
    guard: (u) => ["strategy_rules", "id", u.journal.ruleId],
  },
  {
    name: "POST strategy-rules (on B's strategy)",
    load: () => import("@/app/api/strategy-rules/route"),
    method: "POST",
    params: () => ({}),
    body: (u) => ({
      strategy_id: u.journal.strategyId,
      label: "new rule",
      subject_source: "core",
      subject_key: "shares",
      operator: "is_set",
    }),
    guard: (u) => ["strategy_rules", "strategy_id", u.journal.strategyId],
  },
  {
    name: "PATCH monthly-costs/[id]",
    load: () => import("@/app/api/monthly-costs/[id]/route"),
    method: "PATCH",
    params: (u) => ({ id: u.journal.monthlyCostId }),
    body: () => ({ name: "renamed" }),
    guard: (u) => ["monthly_costs", "id", u.journal.monthlyCostId],
  },
  // ---- deletes (controls run last)
  ...(
    [
      ["trades/[id]/images/[imageId]", () => import("@/app/api/trades/[id]/images/[imageId]/route"), (u: TestUser) => ({ id: u.journal.tradeId, imageId: u.journal.imageId }), (u: TestUser) => ["trade_images", "id", u.journal.imageId]],
      ["chat/conversations/[id]", () => import("@/app/api/chat/conversations/[id]/route"), (u: TestUser) => ({ id: u.journal.conversationId }), (u: TestUser) => ["ai_conversations", "id", u.journal.conversationId]],
      ["ai-reviews/[id]", () => import("@/app/api/ai-reviews/[id]/route"), (u: TestUser) => ({ id: u.journal.reviewId }), (u: TestUser) => ["ai_reviews", "id", u.journal.reviewId]],
      ["ai-keys/[id]", () => import("@/app/api/ai-keys/[id]/route"), (u: TestUser) => ({ id: u.journal.keyId }), (u: TestUser) => ["user_api_keys", "id", u.journal.keyId]],
      ["commission-rules/[id]", () => import("@/app/api/commission-rules/[id]/route"), (u: TestUser) => ({ id: u.journal.commissionRuleId }), (u: TestUser) => ["commission_rules", "id", u.journal.commissionRuleId]],
      ["field-definitions/[id]", () => import("@/app/api/field-definitions/[id]/route"), (u: TestUser) => ({ id: u.journal.fieldId }), (u: TestUser) => ["field_definitions", "id", u.journal.fieldId]],
      ["goals/[id]", () => import("@/app/api/goals/[id]/route"), (u: TestUser) => ({ id: u.journal.goalId }), (u: TestUser) => ["goals", "id", u.journal.goalId]],
      ["strategy-rules/[id]", () => import("@/app/api/strategy-rules/[id]/route"), (u: TestUser) => ({ id: u.journal.ruleId }), (u: TestUser) => ["strategy_rules", "id", u.journal.ruleId]],
      ["strategies/[id]", () => import("@/app/api/strategies/[id]/route"), (u: TestUser) => ({ id: u.journal.strategyId }), (u: TestUser) => ["strategies", "id", u.journal.strategyId]],
      ["folders/[id]", () => import("@/app/api/folders/[id]/route"), (u: TestUser) => ({ id: u.journal.folderId }), (u: TestUser) => ["folders", "id", u.journal.folderId]],
      ["account/transactions/[id]", () => import("@/app/api/account/transactions/[id]/route"), (u: TestUser) => ({ id: u.journal.transactionId }), (u: TestUser) => ["account_transactions", "id", u.journal.transactionId]],
      ["monthly-costs/[id]", () => import("@/app/api/monthly-costs/[id]/route"), (u: TestUser) => ({ id: u.journal.monthlyCostId }), (u: TestUser) => ["monthly_costs", "id", u.journal.monthlyCostId]],
      ["trades/[id]", () => import("@/app/api/trades/[id]/route"), id, tradeGuard],
    ] as const
  ).map(
    ([name, load, params, guard]): Case => ({
      name: `DELETE ${name}`,
      load,
      method: "DELETE",
      params,
      guard: guard as Case["guard"],
      deletes: true,
    }),
  ),
];

async function attack(c: Case) {
  as(A);
  const handler = (await c.load())[c.method] as unknown as Handler;
  expect(handler, `${c.name} has no ${c.method} export`).toBeTypeOf("function");
  const before = c.guard ? await snapshot(...c.guard(B)) : null;
  if (before) expect(before.length, "B's guarded row must exist before the attack").toBeGreaterThan(0);
  await expectRefused(await call(handler, c.method, c.params(B), c.body?.(B), c.query?.(B) ?? ""));
  if (c.guard) expect(await snapshot(...c.guard(B))).toEqual(before);
}

async function control(c: Case) {
  as(A);
  const handler = (await c.load())[c.method] as unknown as Handler;
  await expectOk(await call(handler, c.method, c.params(A), c.body?.(A), c.query?.(A) ?? ""));
}

describe("routes: A aiming at B's records is refused and changes nothing", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_n, c) => attack(c));
});

describe("routes: A's own record with B's ids mixed in", () => {
  it("PUT A's trade folders with B's folder does not link it", async () => {
    as(A);
    const { PUT } = await import("@/app/api/trades/[id]/folders/route");
    await call(PUT as unknown as Handler, "PUT", { id: A.journal.tradeId }, { folderIds: [B.journal.folderId] });
    expect(await snapshot("trade_folders", "folder_id", B.journal.folderId)).toEqual([
      expect.objectContaining({ trade_id: B.journal.tradeId }),
    ]);
  });

  it("PUT A's trade strategies with B's strategy does not link it", async () => {
    as(A);
    const { PUT } = await import("@/app/api/trades/[id]/strategies/route");
    await call(PUT as unknown as Handler, "PUT", { id: A.journal.tradeId }, { strategyIds: [B.journal.strategyId] });
    expect(await snapshot("trade_strategies", "strategy_id", B.journal.strategyId)).toEqual([
      expect.objectContaining({ trade_id: B.journal.tradeId }),
    ]);
  });

  it("PUT A's trade fee = B's fee is refused", async () => {
    as(A);
    const { PUT } = await import("@/app/api/trades/[id]/fee/route");
    const res = await call(PUT as unknown as Handler, "PUT", { id: A.journal.tradeId }, { fee: B.journal.commissionRuleId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [trade] = (await snapshot("trades", "id", A.journal.tradeId)) as { commission_rule_id: string | null }[];
    expect(trade.commission_rule_id).not.toBe(B.journal.commissionRuleId);
  });

  it("restore A's trade from B's history entry is refused", async () => {
    as(A);
    const { POST } = await import("@/app/api/trades/[id]/history/[historyId]/restore/route");
    const res = await call(POST as unknown as Handler, "POST", { id: A.journal.tradeId, historyId: B.journal.historyId });
    expect([403, 404]).toContain(res.status);
  });

  it("PATCH A's conversation onto B's key is refused", async () => {
    as(A);
    const { PATCH } = await import("@/app/api/chat/conversations/[id]/route");
    const res = await call(PATCH as unknown as Handler, "PATCH", { id: A.journal.conversationId }, { keyId: B.journal.keyId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [conv] = (await snapshot("ai_conversations", "id", A.journal.conversationId)) as { key_id: string }[];
    expect(conv.key_id).not.toBe(B.journal.keyId);
  });

  it("start a chat on B's key is refused and creates nothing", async () => {
    as(A);
    const { POST } = await import("@/app/api/chat/conversations/route");
    const res = await call(POST as unknown as Handler, "POST", {}, { keyId: B.journal.keyId });
    expect([400, 403, 404]).toContain(res.status);
    const convs = (await snapshot("ai_conversations", "key_id", B.journal.keyId)) as { user_id: string }[];
    expect(convs.every((c) => c.user_id === B.id)).toBe(true);
  });

  it("period review on B's key is refused before any provider call", async () => {
    as(A);
    const { POST } = await import("@/app/api/ai-reviews/period/route");
    const res = await call(POST as unknown as Handler, "POST", {}, { keyId: B.journal.keyId, kind: "weekly" });
    // 404 "key not found" or 4xx -- never a 2xx and never a provider error (5xx/502).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.text()).not.toContain(B.journal.marker);
  });

  it("export filtered by B's folder returns none of B's trades", async () => {
    as(A);
    const { GET } = await import("@/app/api/trades/export/route");
    const res = await call(GET as unknown as Handler, "GET", {}, undefined, `?format=csv&folder=${B.journal.folderId}`);
    const text = await res.text();
    expect(text).not.toContain(B.journal.marker.slice(0, 9));
  });

  it("GET strategy-rules for B's strategy returns nothing of B's", async () => {
    as(A);
    const { GET } = await import("@/app/api/strategy-rules/route");
    const res = await call(GET as unknown as Handler, "GET", {}, undefined, `?strategyId=${B.journal.strategyId}`);
    expect(await res.text()).not.toContain(B.journal.marker);
  });
});

describe("routes: the same requests on A's own records succeed (controls)", () => {
  const controls = [...CASES.filter((c) => !c.deletes && !c.noControl), ...CASES.filter((c) => c.deletes)];
  it.each(controls.map((c) => [c.name, c] as const))("%s", async (_n, c) => control(c));
  it.each(CASES.filter((c) => c.noControl).map((c) => [c.name, c.noControl!] as const))(
    "%s -- no control: %s",
    () => {},
  );
});

describe("routes: admin-only routes refuse a normal (paid) user", () => {
  it("POST admin/plan", async () => {
    as(A);
    const { POST } = await import("@/app/api/admin/plan/route");
    const res = await call(POST as unknown as Handler, "POST", {}, { userId: A.id, plan: "paid" });
    expect(res.status).toBe(403);
  });
  it("GET admin/waitlist", async () => {
    as(A);
    const { GET } = await import("@/app/api/admin/waitlist/route");
    expect((await (GET as () => Promise<Response>)()).status).toBe(403);
  });
  it("POST admin/analytics-exclusion", async () => {
    as(A);
    const { POST } = await import("@/app/api/admin/analytics-exclusion/route");
    const res = await call(POST as unknown as Handler, "POST", {}, { userId: B.id, excluded: false });
    expect(res.status).toBe(403);
  });
});

describe("routes: no session at all", () => {
  it("every case answers 401", async () => {
    acting.userId = "";
    acting.token = "";
    for (const c of CASES) {
      const handler = (await c.load())[c.method] as unknown as Handler;
      const res = await call(handler, c.method, c.params(B), c.body?.(B));
      expect(res.status, c.name).toBe(401);
    }
  });
});
