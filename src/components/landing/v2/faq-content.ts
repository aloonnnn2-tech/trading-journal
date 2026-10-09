// The homepage FAQ (Phase 2C of docs/design-audit.md). Plain data, so the
// visible <details> list and the FAQPage JSON-LD are built from one source
// and cannot say different things.
//
// EVERY ANSWER IS A CLAIM. Each one was drafted only from the spec's "Facts
// Alon supplies" or from something checkable in the code, noted beside it,
// and faq-content.test.ts fails if an edit slips in a claim that has been
// ruled out: CSV (not confirmed, per the spec -- XLSX only), "every edit" /
// "full version history" (history keeps each trade's newest 50 versions), or
// any broker but Interactive Brokers. Change these with the facts in hand.

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    // v2/PricingTeaser FREE_FEATURES; /paid-plan "What stays free"; the
    // PAID flags in FeatureGrid.
    question: "Is it really free? What's the catch?",
    answer:
      "Yes. The free plan is a complete journal: unlimited trades, the equity curve and drawdown, win rate, profit factor and expectancy, trading rules with automatic mistake tracking, goals, imports and exports, and edit history on every trade. There's no card to enter, and nothing in it expires. What it doesn't include is the paid plan — AI reviews, MAE/MFE and the other features marked PAID — which isn't on sale yet.",
  },
  {
    // /paid-plan: "The free journal stays complete"; the waitlist's own
    // "one email when it launches".
    question: "What happens when the paid plan launches?",
    answer:
      "The free journal stays complete. The paid plan adds features on top of it rather than taking any away. Join the waitlist and you'll get one email when it launches.",
  },
  {
    // Facts: screenshot_import_tested_for = Interactive Brokers, stocks only.
    // Answered strictly from that, by Alon's decision on 2026-09-27.
    question: "Which brokers can I import from?",
    answer:
      "Screenshot import is confirmed working for Interactive Brokers, for stocks: drop in a screenshot and the trade form fills itself. Manual entry works for any broker or market.",
  },
  {
    // Privacy policy, "How screenshot processing works";
    // src/lib/ocr/engines/paddle.ts; ConfidenceBadge.
    question: "How does the screenshot reader work?",
    answer:
      "The text is read on our own servers by offline OCR software — your screenshot isn't sent to a third-party AI or OCR service unless you choose \"Read with AI\" on the paid plan, which uses your own key. Each field it fills in shows how confident it was, so you can check it before saving. The image is kept with the trade, in your account's private storage.",
  },
  {
    // provider-consent-card.tsx; every AI route goes through requirePaidUser;
    // keys are encrypted with AI_KEY_ENCRYPTION_SECRET.
    question: "Is my data used to train AI? Where does my AI key go?",
    answer:
      "We don't train AI on your journal. AI features come with the paid plan and use your own API key with the provider you choose. Before anything is sent, you're shown what goes where, and that provider handles it under its own terms, so check its policy on training. Your key is stored encrypted and never shared.",
  },
  {
    // Facts: export_formats = [XLSX]. CSV deliberately not mentioned, by
    // Alon's decision on 2026-09-27.
    question: "Can I export my data?",
    answer: "Yes. Your trades export to an Excel (XLSX) file from the Trades page, whenever you like.",
  },
  {
    // Facts: markets_supported = [stocks, crypto]; screenshot import is
    // confirmed for stocks only.
    question: "Which markets does it support?",
    answer:
      "Stocks and crypto. Both can be journaled by hand; screenshot import is confirmed for stocks.",
  },
  {
    // No native app exists. The second sentence rests on the site working at
    // phone width, which was checked at 390px when this shipped.
    question: "Is there a mobile app?",
    answer: "Not yet. Trading Lens runs in your browser, on a computer or a phone.",
  },
];

/** The same questions as schema.org FAQPage structured data, for search engines. */
export function faqJsonLd(items: readonly FaqItem[] = FAQ) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
