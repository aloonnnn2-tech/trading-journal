import { serverSecret } from "@/lib/server-env";
import { HELP_EMAIL } from "@/lib/help/config";

/**
 * Sends onboarding mail through Brevo's transactional email API
 * (https://developers.brevo.com/reference/sendtransacemail). Free plan:
 * 300 emails a day.
 *
 * Netlify environment variables:
 *   BREVO_API_KEY  Brevo -> SMTP & API -> API keys (mark it secret)
 *   EMAIL_FROM     optional; the sender address, verified in Brevo under
 *                  Senders. Defaults to the support Gmail (HELP_EMAIL).
 *
 * Replies go to the same address. Unset key means "not configured": the
 * caller runs as a dry run rather than failing.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export function brevoSender(fetchImpl: typeof fetch = fetch): SendMail | null {
  const apiKey = serverSecret("BREVO_API_KEY");
  if (!apiKey) return null;
  const from = process.env.EMAIL_FROM || HELP_EMAIL;

  return async (mail) => {
    const res = await fetchImpl(BREVO_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Trading Lenz", email: from },
        replyTo: { email: from, name: "Trading Lenz" },
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        headers: mail.headers,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Brevo's error body names the problem ("unauthorized", "sender not
      // valid"); never includes the key.
      const body = await res.text().catch(() => "");
      throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
    }
  };
}
