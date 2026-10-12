/**
 * Every route that takes input refuses malformed and wrongly shaped input
 * with a 400 -- never a 500, never a 2xx (security hardening, Phase 4,
 * "Done when"). And every /api path refuses an oversized body with 413
 * before any handler reads it.
 *
 * Runs on the DEV project as a signed-in user against their OWN records, so
 * a refusal here is about the input, not about ownership (that is
 * routes.idor.test.ts). Same harness and mocks as that file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createWorld, destroyWorld, type TestUser } from "./world";
import { DEFAULT_BODY_LIMIT, LARGE_BODY_LIMIT, bodyLimitFor } from "@/lib/http/body-limits";

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
  acting.userId = A.id;
  acting.token = A.accessToken;
});
afterAll(async () => {
  await destroyWorld(A, B);
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Mod = Record<string, unknown>;

interface JsonRoute {
  path: string;
  method: "POST" | "PUT" | "PATCH";
  load: () => Promise<Mod>;
  params?: (u: TestUser) => Record<string, string>;
}

const id = (u: TestUser) => ({ id: u.journal.tradeId });

const JSON_ROUTES: JsonRoute[] = [
  { path: "account/transactions", method: "POST", load: () => import("@/app/api/account/transactions/route") },
  { path: "ai-keys", method: "POST", load: () => import("@/app/api/ai-keys/route") },
  { path: "ai-keys/[id]", method: "PATCH", load: () => import("@/app/api/ai-keys/[id]/route"), params: (u) => ({ id: u.journal.keyId }) },
  { path: "ai-keys/consent", method: "POST", load: () => import("@/app/api/ai-keys/consent/route") },
  { path: "ai-reviews/period", method: "POST", load: () => import("@/app/api/ai-reviews/period/route") },
  { path: "ai-reviews/trade", method: "POST", load: () => import("@/app/api/ai-reviews/trade/route") },
  { path: "analytics/track", method: "POST", load: () => import("@/app/api/analytics/track/route") },
  { path: "analytics/heartbeat", method: "POST", load: () => import("@/app/api/analytics/heartbeat/route") },
  { path: "analytics/public-view", method: "POST", load: () => import("@/app/api/analytics/public-view/route") },
  { path: "chat/conversations", method: "POST", load: () => import("@/app/api/chat/conversations/route") },
  { path: "chat/conversations/[id]", method: "PATCH", load: () => import("@/app/api/chat/conversations/[id]/route"), params: (u) => ({ id: u.journal.conversationId }) },
  { path: "chat/conversations/[id]/turn", method: "POST", load: () => import("@/app/api/chat/conversations/[id]/turn/route"), params: (u) => ({ id: u.journal.conversationId }) },
  { path: "commission-rules", method: "POST", load: () => import("@/app/api/commission-rules/route") },
  { path: "commission-rules/[id]", method: "PATCH", load: () => import("@/app/api/commission-rules/[id]/route"), params: (u) => ({ id: u.journal.commissionRuleId }) },
  { path: "demo", method: "POST", load: () => import("@/app/api/demo/route") },
  { path: "field-definitions", method: "POST", load: () => import("@/app/api/field-definitions/route") },
  { path: "field-definitions/[id]", method: "PATCH", load: () => import("@/app/api/field-definitions/[id]/route"), params: (u) => ({ id: u.journal.fieldId }) },
  { path: "folders", method: "POST", load: () => import("@/app/api/folders/route") },
  { path: "goals", method: "POST", load: () => import("@/app/api/goals/route") },
  { path: "goals/[id]", method: "PATCH", load: () => import("@/app/api/goals/[id]/route"), params: (u) => ({ id: u.journal.goalId }) },
  { path: "monthly-costs", method: "POST", load: () => import("@/app/api/monthly-costs/route") },
  { path: "monthly-costs/[id]", method: "PATCH", load: () => import("@/app/api/monthly-costs/[id]/route"), params: (u) => ({ id: u.journal.monthlyCostId }) },
  { path: "settings/core-fields", method: "PATCH", load: () => import("@/app/api/settings/core-fields/route") },
  { path: "settings/dashboard-layout", method: "PUT", load: () => import("@/app/api/settings/dashboard-layout/route") },
  { path: "settings/preferences", method: "PATCH", load: () => import("@/app/api/settings/preferences/route") },
  { path: "settings/timezone", method: "PATCH", load: () => import("@/app/api/settings/timezone/route") },
  { path: "settings/tour", method: "PATCH", load: () => import("@/app/api/settings/tour/route") },
  { path: "strategies", method: "POST", load: () => import("@/app/api/strategies/route") },
  { path: "strategies/[id]", method: "PATCH", load: () => import("@/app/api/strategies/[id]/route"), params: (u) => ({ id: u.journal.strategyId }) },
  { path: "strategy-rules", method: "POST", load: () => import("@/app/api/strategy-rules/route") },
  { path: "strategy-rules/[id]", method: "PATCH", load: () => import("@/app/api/strategy-rules/[id]/route"), params: (u) => ({ id: u.journal.ruleId }) },
  { path: "trades/[id]", method: "PATCH", load: () => import("@/app/api/trades/[id]/route"), params: id },
  { path: "trades/[id]/fee", method: "PUT", load: () => import("@/app/api/trades/[id]/fee/route"), params: id },
  { path: "trades/[id]/folders", method: "PUT", load: () => import("@/app/api/trades/[id]/folders/route"), params: id },
  { path: "trades/[id]/strategies", method: "PUT", load: () => import("@/app/api/trades/[id]/strategies/route"), params: id },
  { path: "trades/[id]/suggestions", method: "POST", load: () => import("@/app/api/trades/[id]/suggestions/route"), params: id },
  { path: "trades/import", method: "POST", load: () => import("@/app/api/trades/import/route") },
  { path: "trades/import-json", method: "POST", load: () => import("@/app/api/trades/import-json/route") },
  { path: "waitlist", method: "POST", load: () => import("@/app/api/waitlist/route") },
];

const MULTIPART_ROUTES: JsonRoute[] = [
  { path: "trades/[id]/images", method: "POST", load: () => import("@/app/api/trades/[id]/images/route"), params: id },
  { path: "ocr/parse", method: "POST", load: () => import("@/app/api/ocr/parse/route") },
  { path: "trades/import/parse-xlsx", method: "POST", load: () => import("@/app/api/trades/import/parse-xlsx/route") },
];

async function send(r: JsonRoute, body: BodyInit, contentType: string): Promise<{ status: number; text: string }> {
  const handler = (await r.load())[r.method] as Handler;
  expect(handler, `${r.path} has no ${r.method}`).toBeTypeOf("function");
  const req = new Request(`http://localhost/api/${r.path}`, {
    method: r.method,
    body,
    headers: { "content-type": contentType },
  });
  const res = await handler(req, { params: Promise.resolve(r.params?.(A) ?? {}) });
  return { status: res.status, text: (await res.text()).slice(0, 200) };
}

describe("malformed JSON is a 400, never a 500", () => {
  it.each(JSON_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s", async (_n, r) => {
    const { status, text } = await send(r, '{"oops": ', "application/json");
    expect(status, text).toBe(400);
  });
});

describe("a wrongly shaped body (an array, not an object) is a 400", () => {
  it.each(JSON_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s", async (_n, r) => {
    const { status, text } = await send(r, JSON.stringify(["not", "an", "object"]), "application/json");
    expect(status, text).toBe(400);
  });
});

describe("uploads: a non-multipart body, and a non-image file, are 400s", () => {
  it.each(MULTIPART_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))("%s: not multipart", async (_n, r) => {
    const { status, text } = await send(r, "plain text", "text/plain");
    expect(status, text).toBe(400);
  });

  it.each(MULTIPART_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: an SVG/HTML payload wearing an image type",
    async (_n, r) => {
      const fd = new FormData();
      const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      fd.set("file", new File([evil], "chart.gif", { type: "image/gif" }));
      const handler = (await r.load())[r.method] as Handler;
      const res = await handler(new Request(`http://localhost/api/${r.path}`, { method: "POST", body: fd }), {
        params: Promise.resolve(r.params?.(A) ?? {}),
      });
      expect(res.status, (await res.text()).slice(0, 200)).toBe(400);
    },
  );
});

describe("oversized bodies are refused by the proxy (413) before any route", () => {
  const paths = [...JSON_ROUTES, ...MULTIPART_ROUTES].map((r) =>
    `/api/${r.path}`.replace("[id]", "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b"),
  );

  it.each(paths)("%s", async (path) => {
    const { proxy } = await import("@/proxy");
    const limit = bodyLimitFor(path);
    expect([DEFAULT_BODY_LIMIT, LARGE_BODY_LIMIT]).toContain(limit);
    const req = new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-length": String(limit + 1), "content-type": "application/json" },
      body: "{}",
    });
    const res = await proxy(req);
    expect(res.status).toBe(413);
  });
});
