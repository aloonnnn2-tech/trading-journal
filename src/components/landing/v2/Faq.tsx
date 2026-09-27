import { ChevronDown } from "lucide-react";
import { SectionHeadline } from "@/components/landing/v2/SectionHeadline";
import { FAQ, faqJsonLd } from "@/components/landing/v2/faq-content";

// The homepage FAQ (Phase 2C of docs/design-audit.md): the spec's
// <details>/<summary> markup, so every answer is in the server HTML, works
// without JavaScript and opens by keyboard for free -- plus FAQPage
// structured data for search engines. Both come from faq-content.ts; the
// answers are claims, and that file says where each one comes from.
//
// id="faq" is the target of the nav's and footer's FAQ links.

// JSON inside <script> must not contain "<", or a "</script>" in any answer
// would end the tag early and the rest would render as page text. None do
// today; this makes sure none ever can.
const jsonLd = JSON.stringify(faqJsonLd()).replace(/</g, "\\u003c");

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20">
      <SectionHeadline kicker="FAQ">Questions worth asking first</SectionHeadline>
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-10">
        <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-subtle dark:border-subtle dark:bg-card">
          {FAQ.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-medium text-zinc-900 hover:bg-zinc-50 dark:text-zinc-50 dark:hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                  strokeWidth={2}
                />
              </summary>
              <p className="px-5 pb-5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </section>
  );
}
