import { serverSecret } from "@/lib/server-env";

/**
 * Sends onboarding mail from the Trading Lenz Gmail account itself, through
 * a Google Apps Script web app that account owns (scripts/gmail-sender.gs).
 * The script calls GmailApp.sendEmail, so mail genuinely comes from
 * tradinglenz@gmail.com: no app password (Google blocks those on this
 * account), no third-party sender, no postal address on file anywhere.
 * A personal account may send to 100 recipients a day.
 *
 * Netlify environment variables:
 *   GMAIL_SCRIPT_URL     the web app's /exec URL (Deploy -> Manage deployments)
 *   GMAIL_SCRIPT_SECRET  the same value as the script's SECRET property
 *
 * Unset means "not configured": the caller runs as a dry run.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  /** Not supported by GmailApp; kept for a future sender that can set them. */
  headers?: Record<string, string>;
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

export function emailSender(fetchImpl: typeof fetch = fetch): SendMail | null {
  const url = serverSecret("GMAIL_SCRIPT_URL");
  const secret = serverSecret("GMAIL_SCRIPT_SECRET");
  if (!url || !secret) return null;

  return async (mail) => {
    // Apps Script answers a POST with a redirect to the output; fetch follows it.
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, to: mail.to, subject: mail.subject, text: mail.text }),
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await res.text().catch(() => "");
    let parsed: { ok?: boolean; error?: string } = {};
    try {
      parsed = JSON.parse(raw) as { ok?: boolean; error?: string };
    } catch {
      // An HTML page instead of JSON: usually the deployment isn't shared
      // with "Anyone", so Google shows a sign-in page.
    }
    if (!res.ok || parsed.ok !== true) {
      throw new Error(`Gmail script ${res.status}: ${parsed.error ?? raw.slice(0, 120)}`);
    }
  };
}
