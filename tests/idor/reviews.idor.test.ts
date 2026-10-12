/**
 * Reviews of Trading Lens (0064), against the DEV project as two real users:
 * a review is its writer's alone, nobody but an admin can put one on the
 * homepage, the homepage function shows only picked reviews and never an
 * email, and editing takes a review back off. Skipped (with the reason)
 * until migration 0064 is applied there.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createWorld, destroyWorld, type TestUser } from "./world";

let A: TestUser;
let B: TestUser;
let has0064 = false;

beforeAll(async () => {
  const probe = await admin().from("app_reviews").select("id").limit(1);
  has0064 = !probe.error;
  if (!has0064) return;
  ({ A, B } = await createWorld());
});
afterAll(async () => {
  await destroyWorld(A, B);
});

const anon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

describe("reviews: cross-user and homepage rules", () => {
  it("a review is its writer's alone", async (ctx) => {
    if (!has0064) ctx.skip("migration 0064 is not applied on the dev project yet");
    const own = await A.db
      .from("app_reviews")
      .insert({ user_id: A.id, rating: 5, comment: "Great journal", allow_public: true, display_name: "A.", source: "closed_trades" })
      .select("id")
      .single();
    expect(own.error).toBeNull();

    // B writes as A: refused by RLS.
    const forged = await B.db.from("app_reviews").insert({ user_id: A.id, rating: 1, source: "homepage" });
    expect(forged.error).not.toBeNull();
    // B reads, edits or deletes A's: nothing visible, nothing changed.
    expect((await B.db.from("app_reviews").select("*")).data).toEqual([]);
    expect((await B.db.from("app_reviews").update({ comment: "hacked" }).eq("user_id", A.id).select("id")).data).toEqual([]);
    expect((await B.db.from("app_reviews").delete().eq("user_id", A.id).select("id")).data).toEqual([]);
    const still = await admin().from("app_reviews").select("comment").eq("user_id", A.id).single();
    expect(still.data?.comment).toBe("Great journal");
  });

  it("only an admin can feature; the homepage shows only picked reviews, never an email", async (ctx) => {
    if (!has0064) ctx.skip("migration 0064 is not applied on the dev project yet");
    // The writer can't feature their own review (no column grant).
    expect((await A.db.from("app_reviews").update({ featured: true }).eq("user_id", A.id)).error).not.toBeNull();
    // Nor call the admin functions.
    expect((await A.db.rpc("admin_reviews")).error).not.toBeNull();
    const { data: row } = await admin().from("app_reviews").select("id").eq("user_id", A.id).single();
    expect((await A.db.rpc("admin_set_review_featured", { p_review_id: row!.id, p_featured: true })).error).not.toBeNull();

    // Not picked yet: the signed-out homepage sees nothing of it.
    const before = await anon().rpc("public_featured_reviews");
    expect((before.data as { comment: string }[]).some((r) => r.comment === "Great journal")).toBe(false);
    // And can't read the table at all.
    expect((await anon().from("app_reviews").select("*")).data ?? []).toEqual([]);

    // Picked (as the database would for an admin): now shown, without email or ids.
    await admin().from("app_reviews").update({ featured: true }).eq("user_id", A.id);
    const after = await anon().rpc("public_featured_reviews");
    const shown = (after.data as Record<string, unknown>[]).find((r) => r.comment === "Great journal");
    expect(shown).toMatchObject({ rating: 5, display_name: "A." });
    expect(Object.keys(shown!).sort()).toEqual(["comment", "display_name", "rating", "reviewed_at"]);
  });

  it("editing takes a review off the homepage; 1-3 stars can never be on it", async (ctx) => {
    if (!has0064) ctx.skip("migration 0064 is not applied on the dev project yet");
    await A.db.from("app_reviews").update({ comment: "Edited" }).eq("user_id", A.id);
    const { data } = await admin().from("app_reviews").select("featured").eq("user_id", A.id).single();
    expect(data?.featured).toBe(false);

    await B.db.from("app_reviews").insert({ user_id: B.id, rating: 3, comment: "Okay", allow_public: true, source: "homepage" });
    const refused = await admin().from("app_reviews").update({ featured: true }).eq("user_id", B.id);
    expect(refused.error?.code).toBe("23514");
  });
});
