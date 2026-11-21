import type { Config } from "@netlify/functions";

/**
 * Hourly trigger for the onboarding emails (day-0 welcome, day-2 nudge).
 * Thin, like auto-execute-cron.mts: it only calls /api/cron/onboarding-emails
 * with CRON_SECRET. Until BREVO_API_KEY is set in
 * Netlify, that route runs as a dry run and sends nothing.
 */
export default async function handler() {
  const secret = process.env.CRON_SECRET;
  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL;
  if (!secret || !baseUrl) {
    console.error("onboarding-emails cron: CRON_SECRET or site URL missing, skipping run");
    return new Response("Not configured", { status: 503 });
  }
  try {
    const res = await fetch(`${baseUrl}/api/cron/onboarding-emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.text();
    (res.ok ? console.log : console.error)(`onboarding-emails cron: ${res.status}`, body);
    return new Response(body, { status: res.status });
  } catch (err) {
    console.error("onboarding-emails cron: request failed", err);
    return new Response("Request failed", { status: 500 });
  }
}

export const config: Config = {
  schedule: "@hourly",
};
