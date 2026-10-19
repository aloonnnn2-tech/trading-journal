import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/observability/log";

// Readiness: can the app reach its database? What an uptime monitor should
// watch (docs/runbook.md). 200 {status:"ok"} or 503 {status:"unavailable"},
// nothing else: no version, no error text, no timing.
//
// Unauthenticated by design, so it is capped twice: the proxy's per-IP limit
// for signed-out callers, and this app-wide ceiling, so the endpoint can never
// be turned into a stream of database queries. A monitor checks once a minute
// or so; 120 a minute is far above that.
const READY_PER_MINUTE = 120;
const DB_TIMEOUT_MS = 3_000;

export async function GET() {
  const limit = await rateLimit("health:ready", READY_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return Response.json(
      { status: "busy" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    // The cheapest real query there is: one row of the migrations ledger,
    // through the same connection path every request uses.
    const { error } = await createAdminClient()
      .from("schema_migrations")
      .select("filename")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw error;
    return Response.json({ status: "ok" });
  } catch (error) {
    log.error("health.ready_failed", { error });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
