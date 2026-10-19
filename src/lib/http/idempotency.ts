import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Requests that must not run twice (create a trade, duplicate one, import a
// file) carry an Idempotency-Key header: one random key per user action,
// from newIdempotencyKey() on the page. The first request with a key runs;
// a repeat of it -- a double click, a retried request -- gets the first
// one's answer instead of making a second trade.
//
// Kept a day in idempotency_keys (migration 0069), written only here with
// the service role, after the route has authenticated the user.
//
// **Fails open.** No header, the table not there yet (0069 applied by hand),
// the database briefly unreachable: the request simply runs, exactly as it
// did before this existed. Losing duplicate protection for a moment is far
// better than refusing to create a trade.

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

export interface StoredAnswer {
  route: string;
  /** Null while the first request is still running. */
  status: number | null;
  body: unknown;
}

/** Where keys live. The real one is Postgres; tests use memory. */
export interface IdempotencyStore {
  /** True if this request got the key; false if someone already has it. Throws if the store can't answer. */
  claim(userId: string, key: string, route: string): Promise<boolean>;
  get(userId: string, key: string): Promise<StoredAnswer | null>;
  complete(userId: string, key: string, status: number, body: unknown): Promise<void>;
  /** Frees a key whose request failed, so trying again actually tries again. */
  release(userId: string, key: string): Promise<void>;
}

export async function withIdempotency(
  request: Request,
  userId: string,
  route: string,
  run: () => Promise<Response>,
  store: IdempotencyStore = supabaseStore(),
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key || !KEY.test(key)) return run();

  let claimed: boolean;
  try {
    claimed = await store.claim(userId, key, route);
  } catch {
    return run();
  }

  if (!claimed) {
    const previous = await store.get(userId, key).catch(() => null);
    if (!previous) return run();
    if (previous.route !== route) {
      return Response.json({ error: "That request key was already used for something else." }, { status: 422 });
    }
    if (previous.status === null) {
      return Response.json(
        { error: "That request is already being processed. Give it a moment." },
        { status: 409, headers: { "Retry-After": "2" } },
      );
    }
    return Response.json(previous.body, { status: previous.status, headers: { "Idempotent-Replay": "true" } });
  }

  let response: Response;
  try {
    response = await run();
  } catch (err) {
    await store.release(userId, key).catch(() => {});
    throw err;
  }

  // Only a success is worth replaying. A failure frees the key, so the
  // user's retry runs for real.
  if (!response.ok) {
    await store.release(userId, key).catch(() => {});
    return response;
  }
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  await store.complete(userId, key, response.status, body).catch(() => {});
  return response;
}

function supabaseStore(): IdempotencyStore {
  const db = () => createAdminClient();
  return {
    async claim(userId, key, route) {
      const { error } = await db().from("idempotency_keys").insert({ user_id: userId, key, route });
      if (!error) {
        // About 1 in 100 claims clears out keys older than a day, as
        // rate_limit_hit does for its counters: no cron needed.
        if (Math.random() < 0.01) {
          void db()
            .from("idempotency_keys")
            .delete()
            .lt("created_at", new Date(Date.now() - 86_400_000).toISOString())
            .then(() => {});
        }
        return true;
      }
      if (error.code === "23505") return false; // the key is taken
      throw error; // missing table, unreachable: fail open
    },
    async get(userId, key) {
      const { data, error } = await db()
        .from("idempotency_keys")
        .select("route, status, body")
        .eq("user_id", userId)
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return (data as StoredAnswer | null) ?? null;
    },
    async complete(userId, key, status, body) {
      await db().from("idempotency_keys").update({ status, body }).eq("user_id", userId).eq("key", key);
    },
    async release(userId, key) {
      await db().from("idempotency_keys").delete().eq("user_id", userId).eq("key", key);
    },
  };
}
