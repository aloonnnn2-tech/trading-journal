import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Unsubscribe — Trading Lenz",
  robots: { index: false },
};

// Where the link at the bottom of an onboarding email lands. It asks before
// unsubscribing (a button, not the page load), so a mail scanner that opens
// links can't unsubscribe anyone by accident.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const u = one("u");
  const t = one("t");
  const done = one("done") === "1";
  const failed = one("error") === "1";

  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-6 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {done ? "You're unsubscribed" : failed ? "That link didn't work" : "Stop these emails?"}
        </h1>
        {done ? (
          <p className="text-sm text-zinc-500">
            You won&apos;t get any more getting-started emails. Your account and journal are unchanged.
          </p>
        ) : failed || !u || !t ? (
          <p className="text-sm text-zinc-500">
            Use the link from the email itself, or email{" "}
            <a className="text-primary underline" href="mailto:tradinglenz@gmail.com">
              tradinglenz@gmail.com
            </a>{" "}
            and we&apos;ll take you off the list.
          </p>
        ) : (
          <form method="post" action="/api/email/unsubscribe" className="flex flex-col items-center gap-3">
            <input type="hidden" name="u" value={u} />
            <input type="hidden" name="t" value={t} />
            <p className="text-sm text-zinc-500">
              You&apos;ll stop getting the getting-started emails. Your account stays as it is.
            </p>
            <button
              type="submit"
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Unsubscribe
            </button>
          </form>
        )}
        <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          Back to Trading Lenz
        </Link>
      </div>
      <LandingFooter />
    </div>
  );
}
