import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidUser } from "@/lib/ai-keys/guard";
import { dismissProposal } from "@/lib/chat/apply-proposal";
import { logError } from "@/lib/observability/scrub";

// The user turned down a change Ask suggested. Only a pending one can be
// dismissed; an applied change stays applied.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requirePaidUser();
  if (!gate.ok) return gate.response;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await dismissProposal(gate.supabase, id);
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ proposal: result.proposal });
  } catch (err) {
    logError("[chat/proposals/dismiss] failed:", err);
    return NextResponse.json({ error: "Couldn't dismiss that. Try again." }, { status: 500 });
  }
}
