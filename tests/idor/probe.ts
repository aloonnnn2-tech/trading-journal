/**
 * Is the DEV project ready for the IDOR suite? Prints no secrets.
 *   npx tsx tests/idor/probe.ts
 */
import "./env";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path: string): Promise<Response> {
  return fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
}

async function main() {
  const migrations = await get("/rest/v1/schema_migrations?select=filename&order=filename.desc&limit=1");
  const body = await migrations.text();
  console.log(
    "schema:",
    migrations.ok ? `loaded, newest migration ${JSON.parse(body)[0]?.filename ?? "(none)"}` : `NOT loaded (${migrations.status})`,
  );
  const bucket = await get("/storage/v1/bucket/trade-images");
  console.log("trade-images bucket:", bucket.ok ? "present" : `missing (${bucket.status})`);
  const settings = await fetch(`${base}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    signal: AbortSignal.timeout(15_000),
  });
  const s = (await settings.json().catch(() => ({}))) as { mailer_autoconfirm?: boolean };
  console.log("auth reachable:", settings.ok, settings.status, "| email autoconfirm:", s.mailer_autoconfirm ?? "?");
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
