import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import {
  FREE_TOOL_SECTION,
  FreeToolCard,
  FreeToolCta,
  FreeToolHero,
  freeToolMetadata,
  JsonLd,
  SignUpButton,
} from "@/components/landing/free-tools";
import { FREE_TOOLS, FREE_TOOLS_HUB } from "@/lib/free-tools";
import { SITE_URL } from "@/lib/site";

// Every free tool on one page (src/lib/free-tools.ts). The footer links here
// for the ones it doesn't name, and every tool's "More free tools" row ends
// with a link back.

const TITLE = "Free Trading Tools for Swing Traders | Trading Lens";
const DESCRIPTION =
  "Free trading tools: position size and risk/reward calculators, a pre-trade checklist, a trading plan template and practical guides. No sign-up.";

export const metadata: Metadata = freeToolMetadata({ path: FREE_TOOLS_HUB, title: TITLE, description: DESCRIPTION });

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Free trading tools",
  itemListElement: FREE_TOOLS.map((tool, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: tool.name,
    url: `${SITE_URL}${tool.path}`,
  })),
};

const KINDS = ["Calculator", "Template", "Guide"] as const;
const HEADINGS: Record<(typeof KINDS)[number], string> = {
  Calculator: "Calculators",
  Template: "Templates and checklists",
  Guide: "Guides",
};

export default function FreeToolsPage() {
  return (
    <div data-v2-page="landing" className="flex flex-1 flex-col">
      <JsonLd data={JSON_LD} />
      <LandingHeader />

      <FreeToolHero kicker="Free tools" title="Free trading tools">
        Calculators, templates and guides for swing traders. All free, no sign-up, and nothing you
        type is saved or sent.
      </FreeToolHero>

      {KINDS.map((kind) => (
        <section key={kind} className={`${FREE_TOOL_SECTION} pb-10`} aria-labelledby={`tools-${kind}`}>
          <h2 id={`tools-${kind}`} className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {HEADINGS[kind]}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {FREE_TOOLS.filter((t) => t.kind === kind).map((tool) => (
              <FreeToolCard key={tool.path} {...tool} />
            ))}
          </div>
        </section>
      ))}

      <div className="pt-4">
        <FreeToolCta heading="Put it all in one journal" actions={<SignUpButton />}>
          <p>
            Trading Lens is a free trading journal that works out the R multiple of every trade and
            checks each one against your own rules. Free to use, no card.
          </p>
        </FreeToolCta>
      </div>

      <LandingFooter />
    </div>
  );
}
