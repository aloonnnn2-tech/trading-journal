import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { withIdempotency, type IdempotencyStore, type StoredAnswer } from "./idempotency";

function memoryStore(): IdempotencyStore & { rows: Map<string, StoredAnswer> } {
  const rows = new Map<string, StoredAnswer>();
  const id = (u: string, k: string) => `${u}:${k}`;
  return {
    rows,
    async claim(u, k, route) {
      if (rows.has(id(u, k))) return false;
      rows.set(id(u, k), { route, status: null, body: null });
      return true;
    },
    async get(u, k) {
      return rows.get(id(u, k)) ?? null;
    },
    async complete(u, k, status, body) {
      rows.set(id(u, k), { ...rows.get(id(u, k))!, status, body });
    },
    async release(u, k) {
      rows.delete(id(u, k));
    },
  };
}

const request = (key?: string) =>
  new Request("http://x/api/trades", { method: "POST", headers: key ? { "Idempotency-Key": key } : {} });

/** A create route: a new row every time it actually runs. */
function creator() {
  let created = 0;
  return {
    run: async () => Response.json({ id: `trade-${++created}` }, { status: 201 }),
    created: () => created,
  };
}

describe("withIdempotency", () => {
  it("the same key twice makes one trade, and the repeat gets the first answer", async () => {
    const store = memoryStore();
    const c = creator();
    const first = await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, store);
    const second = await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, store);
    expect(c.created()).toBe(1);
    expect(await first.json()).toEqual({ id: "trade-1" });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ id: "trade-1" });
    expect(second.headers.get("Idempotent-Replay")).toBe("true");
  });

  it("a different key, or another user's identical key, runs again", async () => {
    const store = memoryStore();
    const c = creator();
    await withIdempotency(request("key-aaaaaaaa"), "u1", "trades.create", c.run, store);
    await withIdempotency(request("key-bbbbbbbb"), "u1", "trades.create", c.run, store);
    await withIdempotency(request("key-aaaaaaaa"), "u2", "trades.create", c.run, store);
    expect(c.created()).toBe(3);
  });

  it("answers 409 while the first request with that key is still running", async () => {
    const store = memoryStore();
    await store.claim("u1", "key-12345678", "trades.create");
    const c = creator();
    const res = await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, store);
    expect(res.status).toBe(409);
    expect(c.created()).toBe(0);
  });

  it("frees the key when the request fails, so a retry really retries", async () => {
    const store = memoryStore();
    const failing = async () => Response.json({ error: "boom" }, { status: 500 });
    await withIdempotency(request("key-12345678"), "u1", "trades.create", failing, store);
    const c = creator();
    await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, store);
    expect(c.created()).toBe(1);
  });

  it("refuses a key reused on a different route", async () => {
    const store = memoryStore();
    const c = creator();
    await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, store);
    const res = await withIdempotency(request("key-12345678"), "u1", "trades.import", c.run, store);
    expect(res.status).toBe(422);
  });

  it("fails open: no header, a malformed key, or a store that can't answer all just run", async () => {
    const broken: IdempotencyStore = {
      claim: async () => {
        throw new Error("relation does not exist");
      },
      get: async () => null,
      complete: async () => {},
      release: async () => {},
    };
    const c = creator();
    await withIdempotency(request(), "u1", "trades.create", c.run, memoryStore());
    await withIdempotency(request("bad key!"), "u1", "trades.create", c.run, memoryStore());
    await withIdempotency(request("key-12345678"), "u1", "trades.create", c.run, broken);
    expect(c.created()).toBe(3);
  });
});
