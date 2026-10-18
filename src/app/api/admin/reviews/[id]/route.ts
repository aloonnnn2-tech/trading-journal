import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { isAdmin } from "@/lib/tracking/admin-queries";
import { recordAudit } from "@/lib/admin/audit";
import { enforceRateLimit } from "@/lib/rate-limit";
import { setReviewFeatured } from "@/lib/reviews/queries";

// Admin -> Reviews: put a review on the homepage, or take it off. The
// database function checks is_admin again and its constraint refuses any
// review that isn't public, 4-5 stars and with a comment.

const bodySchema = z.object({ featured: z.boolean() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(`admin-reviews:${userId}`, 60, 60_000);
  if (limited) return limited;

  const supabase = await createClient();
  if (!(await isAdmin(supabase, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Expected { featured }" }, { status: 400 });

  try {
    await setReviewFeatured(supabase, id, parsed.data.featured);
  } catch (error) {
    if ((error as { code?: string })?.code === "23514") {
      return NextResponse.json(
        { error: "Only 4–5 star reviews with a comment, whose writer allowed it, can go on the homepage." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Couldn't update that review." }, { status: 500 });
  }
  await recordAudit({ actorId: userId, action: "review_featured", target: id, detail: { featured: parsed.data.featured } });
  return NextResponse.json({ ok: true });
}
