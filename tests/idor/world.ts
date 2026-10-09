/**
 * Two users with identical journals, on the DEV project.
 *
 * Every record kind a route can address by id gets one row per user, so a
 * test can aim the same request at the caller's own record (must work --
 * proves the request itself is valid) and at the other user's record (must
 * be refused, and leave that record untouched). Without the first half, a
 * 400 from a malformed body would pass as "access denied".
 *
 * Seeded with the service-role client: the point is the state, not the
 * route that made it. Torn down by deleting the users -- every table
 * cascades from auth.users.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const IMAGE_BUCKET = "trade-images";
// 1x1 transparent PNG.
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export interface Journal {
  tradeId: string;
  historyId: string;
  imageId: string;
  imagePath: string;
  folderId: string;
  strategyId: string;
  ruleId: string;
  fieldId: string;
  commissionRuleId: string;
  goalId: string;
  transactionId: string;
  monthlyCostId: string;
  keyId: string;
  conversationId: string;
  reviewId: string;
  /** Unique text planted in this user's rows; must never appear in the other user's responses. */
  marker: string;
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  /** PostgREST/Storage client carrying this user's JWT -- what RLS sees. */
  db: SupabaseClient;
  journal: Journal;
}

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };

export const admin = () => createClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);

export function clientFor(accessToken: string): SupabaseClient {
  return createClient(url(), anonKey(), {
    ...opts,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function must<T>(label: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error || res.data == null) throw new Error(`seed ${label}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

async function seedJournal(a: SupabaseClient, userId: string, tag: string): Promise<Journal> {
  const marker = `IDOR${tag}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const one = <T extends { id: string }>(label: string, table: string, row: Record<string, unknown>) =>
    a.from(table).insert({ user_id: userId, ...row }).select("id").single<T>().then((r) => must(label, r).id);

  const tradeId = await one("trade", "trades", {
    ticker: marker.slice(0, 10),
    direction: "long",
    status: "open",
  });
  // An edit writes the old version to trade_history (trigger, 0008).
  must("trade edit", await a.from("trades").update({ ticker: marker.slice(0, 9) }).eq("id", tradeId).select("id"));
  const historyId = must(
    "history",
    await a.from("trade_history").select("id").eq("trade_id", tradeId).limit(1).single<{ id: string }>(),
  ).id;

  const imagePath = `${userId}/${tradeId}/${crypto.randomUUID()}.png`;
  const up = await a.storage.from(IMAGE_BUCKET).upload(imagePath, TINY_PNG, { contentType: "image/png" });
  if (up.error) throw new Error(`seed image upload: ${up.error.message}`);
  const imageId = await one("image", "trade_images", { trade_id: tradeId, storage_path: imagePath });

  const folderId = await one("folder", "folders", { name: `${marker} folder` });
  must("trade_folder", await a.from("trade_folders").insert({ trade_id: tradeId, folder_id: folderId }).select("trade_id"));

  const strategyId = await one("strategy", "strategies", { name: `${marker} strategy` });
  must(
    "trade_strategy",
    await a.from("trade_strategies").insert({ trade_id: tradeId, strategy_id: strategyId }).select("trade_id"),
  );
  const ruleId = await one("strategy rule", "strategy_rules", {
    strategy_id: strategyId,
    label: `${marker} rule`,
    subject_source: "core",
    subject_key: "shares",
    operator: "is_set",
  });

  const fieldId = await one("field", "field_definitions", {
    entity_type: "trade",
    key: `idor_${tag.toLowerCase()}`,
    label: `${marker} field`,
    field_type: "text",
  });
  const commissionRuleId = await one("commission rule", "commission_rules", {
    name: `${marker} fee`,
    rule_type: "flat",
    amount: 1,
  });
  const goalId = await one("goal", "goals", {
    label: `${marker} goal`,
    kind: "aggregate",
    metric: "trade_count",
    target: 5,
    target_direction: "at_least",
    period: "month",
  });
  const transactionId = await one("transaction", "account_transactions", { amount: 1000, note: `${marker} deposit` });
  const monthlyCostId = await one("monthly cost", "monthly_costs", { name: `${marker} cost`, amount: 10 });

  const keyId = await one("api key", "user_api_keys", {
    provider: "openai",
    // Not a real ciphertext: no test path may get as far as decrypting it.
    encrypted_key: `v3:not-a-real-key:${marker}`,
    last_four: "abcd",
    label: `${marker} key`,
  });
  const conversationId = await one("conversation", "ai_conversations", {
    provider: "openai",
    model: "gpt-4o-mini",
    key_id: keyId,
    title: `${marker} chat`,
  });
  must(
    "message",
    await a
      .from("ai_messages")
      .insert({ user_id: userId, conversation_id: conversationId, seq: 1, role: "user", content: `${marker} question` })
      .select("id"),
  );
  const reviewId = await one("review", "ai_reviews", {
    review_type: "trade",
    trade_id: tradeId,
    trades_analyzed: 1,
    provider: "openai",
    model: "gpt-4o-mini",
    content: { summary: `${marker} review` },
  });
  must(
    "excursion",
    await a
      .from("trade_excursions")
      .insert({ trade_id: tradeId, user_id: userId, symbol: marker.slice(0, 8), status: "ok" })
      .select("trade_id"),
  );

  return {
    tradeId,
    historyId,
    imageId,
    imagePath,
    folderId,
    strategyId,
    ruleId,
    fieldId,
    commissionRuleId,
    goalId,
    transactionId,
    monthlyCostId,
    keyId,
    conversationId,
    reviewId,
    marker,
  };
}

async function createUser(tag: string): Promise<TestUser> {
  const a = admin();
  const email = `idor-${tag.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@tradinglens-e2e.invalid`;
  const password = `Idor!${crypto.randomUUID()}Aa1`;
  const created = await a.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create user ${tag}: ${created.error?.message}`);
  const id = created.data.user.id;

  // Paid, so the paid-only routes reach their ownership checks instead of
  // stopping at the plan gate. Never an admin.
  must(
    "plan",
    await a.from("user_settings").upsert({ user_id: id, plan: "paid", excluded_from_analytics: true }).select("user_id"),
  );

  const anon = createClient(url(), anonKey(), opts);
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`sign in ${tag}: ${signedIn.error?.message}`);
  const accessToken = signedIn.data.session.access_token;

  const journal = await seedJournal(a, id, tag);
  return { id, email, accessToken, db: clientFor(accessToken), journal };
}

export async function createWorld(): Promise<{ A: TestUser; B: TestUser }> {
  const [A, B] = await Promise.all([createUser("A"), createUser("B")]);
  return { A, B };
}

export async function destroyWorld(...users: (TestUser | undefined)[]): Promise<void> {
  const a = admin();
  for (const u of users) {
    if (!u) continue;
    // Storage objects do not cascade with the user.
    const { data: files } = await a.storage.from(IMAGE_BUCKET).list(`${u.id}/${u.journal.tradeId}`);
    if (files?.length) {
      await a.storage.from(IMAGE_BUCKET).remove(files.map((f) => `${u.id}/${u.journal.tradeId}/${f.name}`));
    }
    await a.auth.admin.deleteUser(u.id);
  }
}

/** Current copy of a row, read past RLS -- for "is B's record untouched?". */
export async function snapshot(table: string, column: string, value: string): Promise<unknown[]> {
  const { data, error } = await admin().from(table).select("*").eq(column, value);
  if (error) throw new Error(`snapshot ${table}: ${error.message}`);
  return data ?? [];
}
