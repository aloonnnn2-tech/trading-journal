import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { FREE_TOOLS, FREE_TOOLS_HUB } from "@/lib/free-tools";
import { BASE_OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";

// Pieces shared by the free-tool pages (the list is src/lib/free-tools.ts).
//
// None of them carries <PublicViewBeacon>: record_public_view (migration
// 0043) only accepts a fixed list of paths, so counting these needs a
// migration first.

/** Phone gutter is 16px (px-4), wider than the landing page's 24px: these are
 *  reading pages, and a 375px screen needs the width for tables. */
export const FREE_TOOL_SECTION = "mx-auto w-full max-w-4xl px-4 sm:px-10";

/** Prose styles, shared so every tool page reads the same. */
export const PROSE = {
  h2: "mt-12 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50",
  h3: "mt-8 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50",
  p: "mt-4 leading-relaxed text-zinc-700 dark:text-zinc-300",
  ul: "mt-4 flex list-disc flex-col gap-2 pl-5 leading-relaxed text-zinc-700 marker:text-zinc-400 dark:text-zinc-300",
  b: "font-semibold text-zinc-900 dark:text-zinc-50",
  a: "font-medium text-primary hover:underline",
};

/**
 * A free-tool page's metadata. `absolute` so no parent template appends to
 * the title, and og/twitter set explicitly: Next derives neither from the
 * page's own title and description, and it REPLACES the parent's openGraph
 * rather than merging, hence BASE_OPEN_GRAPH (see src/lib/site.ts).
 */
export function freeToolMetadata({
  path,
  title,
  description,
  article,
}: {
  path: string;
  title: string;
  description: string;
  /** Publication date, for guides. Makes og:type "article". */
  article?: { published: string };
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      ...BASE_OPEN_GRAPH,
      url: path,
      title,
      description,
      ...(article && { type: "article", publishedTime: article.published }),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const PUBLISHER = { "@type": "Organization", name: SITE_NAME, url: SITE_URL };

export function webAppJsonLd({
  path,
  name,
  description,
  category = "FinanceApplication",
}: {
  path: string;
  name: string;
  description: string;
  category?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    url: `${SITE_URL}${path}`,
    description,
    applicationCategory: category,
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: PUBLISHER,
  };
}

export function articleJsonLd({
  path,
  headline,
  description,
  published,
}: {
  path: string;
  headline: string;
  description: string;
  published: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    url: `${SITE_URL}${path}`,
    mainEntityOfPage: `${SITE_URL}${path}`,
    image: `${SITE_URL}/opengraph-image`,
    datePublished: published,
    dateModified: published,
    author: PUBLISHER,
    publisher: PUBLISHER,
  };
}

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

/** The kicker, the page's one <h1> and the intro paragraph. */
export function FreeToolHero({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${FREE_TOOL_SECTION} pt-12 pb-8 sm:pt-16 print:hidden`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{kicker}</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</p>
    </section>
  );
}

export const PRIMARY_BUTTON =
  "inline-block rounded-lg bg-primary px-6 py-3 text-center font-medium text-white transition hover:bg-primary-hover dark:text-zinc-950";

export const SECONDARY_BUTTON =
  "inline-block rounded-lg border border-zinc-300 px-6 py-3 text-center font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-subtle dark:text-zinc-50 dark:hover:bg-white/5";

/** The closing ask on every tool page. Buttons are passed in; the sign-up one
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
    <section className={`${FREE_TOOL_SECTION} pb-14 print:hidden`}>
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

/** A tool as a card, for the hub and the "More free tools" row. */
export function FreeToolCard({ path, name, blurb, kind }: (typeof FREE_TOOLS)[number]) {
  return (
    <Link
      href={path}
      className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-primary dark:border-subtle dark:bg-card dark:hover:border-primary"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{kind}</span>
      <span className="mt-2 font-semibold tracking-tight text-zinc-900 group-hover:text-primary dark:text-zinc-50">
        {name}
      </span>
      <span className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{blurb}</span>
    </Link>
  );
}

/** Links every tool page to the others: the internal links are part of how
 *  search engines find and weigh them. */
export function MoreFreeTools({ current }: { current: string }) {
  const others = FREE_TOOLS.filter((t) => t.path !== current).slice(0, 3);
  return (
    <section className={`${FREE_TOOL_SECTION} pb-20 print:hidden`} aria-labelledby="more-free-tools">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="more-free-tools" className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          More free tools
        </h2>
        <Link href={FREE_TOOLS_HUB} className="text-sm font-medium text-primary hover:underline">
          See all
        </Link>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {others.map((tool) => (
          <FreeToolCard key={tool.path} {...tool} />
        ))}
      </div>
    </section>
  );
}
