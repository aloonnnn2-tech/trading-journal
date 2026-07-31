import type { Config } from "@netlify/functions";

/**
 * Scheduled trigger for background auto-execution.
 *
 * Deliberately thin: it holds no trading logic, just calls the app's own
 * `/api/cron/auto-execute` route with the shared secret. That keeps the
 * decision logic in one typed place shared with the in-browser hook
 * (src/lib/trades/auto-execute.ts) instead of forking a second copy here.
 *
 * Requires two environment variables in Netlify:
 *   CRON_SECRET  — same value the API route checks
 *   URL          — set automatically by Netlify to the site's base URL
 */
export default async function handler() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("auto-execute cron: CRON_SECRET is not set, skipping run");
    return new Response("CRON_SECRET not configured", { status: 503 });
  }

  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL;
  if (!baseUrl) {
    console.error("auto-execute cron: no site URL available, skipping run");
    return new Response("Site URL unavailable", { status: 503 });
  }

  try {
    const res = await fetch(`${baseUrl}/api/cron/auto-execute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();

    if (!res.ok) {
      console.error(`auto-execute cron: route returned ${res.status}`, body);
      return new Response(body, { status: res.status });
    }
    // Netlify captures this in the function log — the only visibility into
    // a job that otherwise runs unattended.
    console.log("auto-execute cron:", body);
    return new Response(body, { status: 200 });
  } catch (err) {
    console.error("auto-execute cron: request failed", err);
    return new Response("Request failed", { status: 500 });
  }
}

export const config: Config = {
  // Every 15 minutes. Frequent enough that a touched level is noticed the
  // same session, infrequent enough to stay well inside Netlify's free
  // scheduled-function allowance and to be gentle on Yahoo's unofficial
  // endpoint. Daily high/low only move so fast; a tighter schedule would
  // add load without changing outcomes.
  schedule: "*/15 * * * *",
};
