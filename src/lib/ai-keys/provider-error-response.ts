import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markApiKeyInvalid } from "./queries";
import { providerModel, ProviderError } from "./providers";
import type { AIProviderName } from "./types";

/**
 * Turns a failed provider call into the right HTTP response, for every route
 * that talks to a provider.
 *
 * Extracted for the same reason as requirePaidUser() in guard.ts: this was
 * ~60 lines at the bottom of the ask route, and the two AI review routes need
 * byte-for-byte the same behaviour. Three hand-copied versions is three
 * chances for one to drift, and the one that drifts is the one that leaves a
 * revoked key listed as working, or -- worse -- returns a provider's raw error
 * body to the client.
 *
 * Two invariants live here rather than in the callers:
 *
 *  1. **The provider's own error text is logged, never returned.** Those
 *     bodies can echo back parts of the request, which for these routes means
 *     echoing the user's journal into an HTTP response.
 *  2. **A rejected key is parked.** Keys are verified once at save time and
 *     never re-checked, so without this a revoked key stays listed as working
 *     and every request through it fails identically with nothing to indicate
 *     that the key itself is the thing to fix.
 */
export async function providerErrorResponse(
  err: unknown,
  ctx: {
    supabase: SupabaseClient;
    provider: AIProviderName;
    keyId: string;
    /** Route tag for the server log, e.g. "ask-ai" or "ai-review". */
    logPrefix: string;
    /**
     * What the user should do when the model ran out of room. Differs by
     * route -- "ask something shorter" is useless advice on a route where the
     * user never wrote a question -- so the caller supplies it.
     */
    truncatedHint: string;
  },
): Promise<NextResponse> {
  // Distinct outcomes, because they need different actions from the user.
  // Collapsing them into one "something went wrong" leaves a user with a
  // revoked key retrying forever.
  const failure = err instanceof ProviderError ? err.failure : "failed";
  const detail = err instanceof ProviderError ? err.detail : String(err);
  console.error(`[${ctx.logPrefix}] ${ctx.provider} ${failure}:`, detail);

  if (failure === "invalid_key") {
    await markApiKeyInvalid(ctx.supabase, ctx.keyId);
    return NextResponse.json(
      {
        error:
          "That provider rejected your API key, so it's been switched off. It was probably revoked or rotated — remove it and add a fresh one.",
      },
      { status: 502 },
    );
  }
  if (failure === "model_missing") {
    return NextResponse.json(
      {
        error: `${ctx.provider} no longer offers the model this app asks for (${providerModel(ctx.provider)}). Your key is fine — this needs updating in the app.`,
      },
      { status: 502 },
    );
  }
  if (failure === "truncated") {
    return NextResponse.json({ error: ctx.truncatedHint }, { status: 502 });
  }
  if (failure === "unavailable") {
    return NextResponse.json(
      {
        error:
          "That provider is unavailable right now, or you've hit its rate limit or quota. Try again in a moment.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "Couldn't get an answer from that provider. Try again, or try a different key." },
    { status: 502 },
  );
}
