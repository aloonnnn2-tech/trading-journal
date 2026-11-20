import nodemailer from "nodemailer";
import { serverSecret } from "@/lib/server-env";

/**
 * Sends mail from the Trading Lenz Gmail account over Gmail's SMTP, signed in
 * with an app password (Google account -> Security -> 2-Step Verification ->
 * App passwords). Two Netlify environment variables:
 *
 *   GMAIL_USER          the address, e.g. tradinglenz@gmail.com
 *   GMAIL_APP_PASSWORD  the 16-character app password (mark it secret)
 *
 * Unset means "not configured": callers skip sending rather than fail.
 * A personal Gmail account may send about 500 messages a day.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

export function gmailSender(): SendMail | null {
  const user = serverSecret("GMAIL_USER");
  const pass = serverSecret("GMAIL_APP_PASSWORD");
  if (!user || !pass) return null;

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: pass.replace(/\s+/g, "") },
  });

  return async (mail) => {
    await transport.sendMail({
      from: { name: "Trading Lenz", address: user },
      replyTo: user,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      headers: mail.headers,
    });
  };
}
