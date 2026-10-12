import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import { setDashboardLayout } from "@/lib/settings/queries";
import { normalizeDashboardLayout } from "@/lib/dashboard/layout";

const WIDGET_ID = z.string().min(1).max(40);
const bodySchema = z
  .object({
    order: z.array(WIDGET_ID).max(30).optional(),
    sizes: z.record(WIDGET_ID, z.enum(["sm", "md", "lg"])).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v.sizes ?? {}).length <= 30, "Too many widgets");

export async function PUT(request: Request) {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid layout" }, { status: 400 });
  }
  // Widget ids stay plain strings rather than the enum: a tab open since
  // before a widget was removed may still send it, and the normalizer drops
  // ids it does not know. Shape and size are what is enforced here.
  const layout = normalizeDashboardLayout(parsed.data as Parameters<typeof normalizeDashboardLayout>[0]);
  const saved = await setDashboardLayout(supabase, userId, layout);
  return NextResponse.json(saved);
}
