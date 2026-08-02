import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserIdFromHeader } from "@/lib/supabase/auth";
import {
  addAccountTransaction,
  getAccountBalance,
  listAccountTransactions,
} from "@/lib/account/queries";
import { logEvent, SERVER_SESSION_ID } from "@/lib/tracking/log";

const createSchema = z.object({
  amount: z
    .number()
    .finite()
    .refine((v) => v !== 0, "Amount cannot be zero")
    .refine((v) => Math.abs(v) <= 1_000_000_000, "Amount is too large"),
  note: z.string().max(200).optional(),
});

export async function GET() {
  const userId = await getUserIdFromHeader();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const [balance, transactions] = await Promise.all([
    getAccountBalance(supabase),
    listAccountTransactions(supabase),
  ]);

  return NextResponse.json({ ...balance, transactions });
}

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const transaction = await addAccountTransaction(
    supabase,
    userId,
    parsed.data.amount,
    parsed.data.note,
  );
  const balance = await getAccountBalance(supabase);
  void logEvent(supabase, userId, SERVER_SESSION_ID, "account_transaction_added", {
    transactionId: transaction.id,
  });

  return NextResponse.json({ transaction, ...balance }, { status: 201 });
}
