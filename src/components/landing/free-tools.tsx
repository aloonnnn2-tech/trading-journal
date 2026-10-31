import Link from "next/link";
import { headers } from "next/headers";

// Pieces shared by the two free-tool pages, /position-size-calculator and
// /how-to-journal-a-swing-trade.
//
// Neither page carries <PublicViewBeacon>: record_public_view (migration
// 0043) only accepts a fixed list of paths, so counting these needs a
// migration first.

/** Phone gutter is 16px (px-4), wider than the landing page's 24px: these are
 *  reading pages, and a 375px screen needs the width for tables. */
export const FREE_TOOL_SECTION = "mx-auto w-full max-w-4xl px-4 sm:px-10";

/**
 * Structured data for search engines. A native <script>, not next/script: it
 * is data, never executed. Nonced anyway so it matches every other inline
 * script under the CSP in src/proxy.ts. `<` is escaped so no string in the
 * payload can close the tag (Next's JSON-LD guide).
 */
export async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export const PRIMARY_BUTTON =
  "inline-block rounded-lg bg-primary px-6 py-3 text-center font-medium text-white transition hover:bg-primary-hover dark:text-zinc-950";

export const SECONDARY_BUTTON =
  "inline-block rounded-lg border border-zinc-300 px-6 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-subtle dark:text-zinc-50 dark:hover:bg-white/5";

/** The closing ask on both pages. Buttons are passed in; the sign-up one
 *  always goes to /sign-up, the landing page's own "Start journaling free". */
export function FreeToolCta({
  heading,
  children,
  actions,
}: {
  heading: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <section className={`${FREE_TOOL_SECTION} pb-20`}>
      <div className="rounded-2xl border border-zinc-200 bg-band-cta px-5 py-10 text-center dark:border-subtle sm:px-10">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{heading}</h2>
        <div className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">{children}</div>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          {actions}
        </div>
      </div>
    </section>
  );
}

export function SignUpButton({ children = "Try Trading Lens free" }: { children?: React.ReactNode }) {
  return (
    <Link href="/sign-up" className={PRIMARY_BUTTON}>
      {children}
    </Link>
  );
}
