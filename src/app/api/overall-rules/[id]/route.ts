import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { rateLimit } from "@/lib/rate-limit";
import { deleteOverallRule, updateOverallRule } from "@/lib/overall-rules/queries";
import { overallRuleSchema } from "@/lib/overall-rules/schema";

// No explicit ownership check: RLS scopes both statements to the caller, so
// another user's rule id matches nothing and is reported as 404, never 403
// (which would confirm it exists).

async function guard(params: Promise<{ id: string }>): Promise<{ response: NextResponse } | { id: string }> {
  const { id } = await params;
  const userId = await getUserIdFromHeader();
  if (!userId) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!z.uuid().safeParse(id).success) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const limit = await rateLimit(`overall-rules-write:${userId}`, 60, 60_000);
  if (!limit.ok) {
    return {
      response: NextResponse.json(
        { error: "Too many changes in a row. Wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      ),
    };
  }
  return { id };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(params);
  if ("response" in g) return g.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // The whole definition, as on create: a partial change can't be checked
  // against the parts it doesn't carry.
  const parsed = overallRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rule" }, { status: 400 });
  }
  const supabase = await createClient();
  const updated = await updateOverallRule(supabase, g.id, parsed.data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(params);
  if ("response" in g) return g.response;
  const supabase = await createClient();
  if (!(await deleteOverallRule(supabase, g.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
