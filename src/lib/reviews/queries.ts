import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeaturedReview, MyReview, ReviewInput } from "./types";

// Reviews of Trading Lens (migration 0064). Every read and write here goes
// through the caller's own RLS client: a user's review is theirs alone, and
// the admin functions check is_admin in the database themselves.

/** 0064 not applied yet: the feature stays quietly off instead of erroring. */
export function isMissingReviews(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST202" || e?.code === "42883") return true;
  return e?.code === "42703" && /app_reviews|review_prompt/.test(e?.message ?? "");
}

interface Row {
  rating: number;
  comment: string | null;
  allow_public: boolean;
  display_name: string | null;
  featured: boolean;
  updated_at: string;
}

const toMine = (r: Row): MyReview => ({
  rating: r.rating,
  comment: r.comment,
  allowPublic: r.allow_public,
  displayName: r.display_name,
  featured: r.featured,
  updatedAt: r.updated_at,
});

const COLUMNS = "rating, comment, allow_public, display_name, featured, updated_at";

export async function getMyReview(supabase: SupabaseClient, userId: string): Promise<MyReview | null> {
  const { data, error } = await supabase.from("app_reviews").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingReviews(error)) return null;
    throw error;
  }
  return data ? toMine(data as Row) : null;
}

/** Writes the caller's review: an update when one exists (the first
 *  `source` is kept -- it says where the review was first asked for), an
 *  insert otherwise. Not an upsert: the user has no update grant on
 *  user_id, which PostgREST's upsert would set. */
export async function saveMyReview(supabase: SupabaseClient, userId: string, input: ReviewInput): Promise<MyReview> {
  const values = {
    rating: input.rating,
    comment: input.comment,
    allow_public: input.allowPublic,
    // A name is only kept when the writer allows public display.
    display_name: input.allowPublic ? input.displayName : null,
  };
  const existing = await getMyReview(supabase, userId);
  const { data, error } = existing
    ? await supabase.from("app_reviews").update(values).eq("user_id", userId).select(COLUMNS).single()
    : await supabase.from("app_reviews").insert({ ...values, user_id: userId, source: input.source }).select(COLUMNS).single();
  if (error) throw error;
  return toMine(data as Row);
}

export async function deleteMyReview(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.from("app_reviews").delete().eq("user_id", userId);
  if (error && !isMissingReviews(error)) throw error;
}

/** The homepage's reviews: only those Alon picked (4-5 stars, a quote, the
 *  writer's permission). Callable signed out. Never throws: no reviews is a
 *  normal state, and the homepage must render either way. */
export async function listFeaturedReviews(supabase: SupabaseClient): Promise<FeaturedReview[]> {
  try {
    const { data, error } = await supabase.rpc("public_featured_reviews");
    if (error || !Array.isArray(data)) return [];
    return (data as { rating: number; comment: string; display_name: string | null; reviewed_at: string }[]).map((r) => ({
      rating: r.rating,
      comment: r.comment,
      displayName: r.display_name,
      reviewedAt: r.reviewed_at,
    }));
  } catch {
    return [];
  }
}

export interface AdminReview {
  id: string;
  userId: string;
  email: string | null;
  rating: number;
  comment: string | null;
  allowPublic: boolean;
  displayName: string | null;
  source: string;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Every review, newest first, with the account's email. Admin only: the
 *  database function refuses anyone else. */
export async function listAllReviews(supabase: SupabaseClient): Promise<AdminReview[]> {
  const { data, error } = await supabase.rpc("admin_reviews");
  if (error) throw error;
  return ((data ?? []) as {
    id: string;
    user_id: string;
    email: string | null;
    rating: number;
    comment: string | null;
    allow_public: boolean;
    display_name: string | null;
    source: string;
    featured: boolean;
    created_at: string;
    updated_at: string;
  }[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    rating: r.rating,
    comment: r.comment,
    allowPublic: r.allow_public,
    displayName: r.display_name,
    source: r.source,
    featured: r.featured,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function setReviewFeatured(supabase: SupabaseClient, reviewId: string, featured: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_review_featured", { p_review_id: reviewId, p_featured: featured });
  if (error) throw error;
}

export interface PromptRow {
  /** The shared demo account and test accounts (0044): never asked, and
   *  can't write a review -- anyone can sign into the demo. */
  excluded_from_analytics: boolean;
  review_prompt_dismissed: boolean;
  review_prompt_snoozed_until: string | null;
  review_prompt_count: number;
}

export async function getPromptState(supabase: SupabaseClient, userId: string): Promise<PromptRow | null> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("excluded_from_analytics, review_prompt_dismissed, review_prompt_snoozed_until, review_prompt_count")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingReviews(error) || (error as { code?: string }).code === "42703") return null;
    throw error;
  }
  return (data as PromptRow | null) ?? null;
}
