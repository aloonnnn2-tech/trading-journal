import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { applyProposal } from "@/lib/chat/apply-proposal";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/observability/scrub";

// The user pressed Apply on a change Ask suggested. The body is empty on
// purpose: the click names a proposal, it supplies no content. What gets
// written is the stored proposal, validated again (src/lib/chat/apply-proposal.ts).
// Cross-site requests never get here (src/proxy.ts refuses them for /api/*).

const LIMIT = 30;
const WINDOW_MS = 60_000;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limit = await rateLimit(`chat-apply:${gate.userId}`, LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many changes in a row. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    // RLS: someone else's proposal id simply doesn't resolve.
    const result = await applyProposal(gate.supabase, gate.userId, id);
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ proposal: result.proposal });
  } catch (err) {
    logError("[chat/proposals/apply] failed:", err);
    return NextResponse.json({ error: "Couldn't apply that. Nothing was changed." }, { status: 500 });
  }
}
