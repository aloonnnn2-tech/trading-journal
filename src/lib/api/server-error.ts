import { NextResponse } from "next/server";
import { currentRequestId, log } from "@/lib/observability/log";

// One way for an API route to fail on the server's side (security gaps pass,
// 3.4): the person gets a plain message and the request id, the detail goes
// to the server log only, redacted by log.ts.
//
// Supabase error text, SQL fragments, file paths and stack traces describe
// the inside of the system. Returning them told an attacker which table or
// file a request touched and helped them shape the next one, and told a
// user nothing they could act on.

export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Try again in a moment.";

/** Logs `err` under `event` and returns the generic response. */
export async function serverError(
  event: string,
  err: unknown,
  options: { status?: number; message?: string; context?: Record<string, unknown> } = {},
): Promise<NextResponse> {
  log.error(event, { ...options.context, error: err });
  const requestId = await currentRequestId();
  return NextResponse.json(
    { error: options.message ?? SERVER_ERROR_MESSAGE, ...(requestId ? { requestId } : {}) },
    { status: options.status ?? 500 },
  );
}

/** For results that carry a failure inside a 200 (bulk jobs): the safe text plus the log line. */
export function safeFailureMessage(event: string, err: unknown, context?: Record<string, unknown>): string {
  log.error(event, { ...context, error: err });
  return SERVER_ERROR_MESSAGE;
}
