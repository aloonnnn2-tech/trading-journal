import { FeatureStory } from "@/components/landing/FeatureStory";
import { AnalyticsPanel, InsightPanel, CalendarPanel } from "@/components/landing/illustrations";

const STORIES = [
  {
    tag: { text: "Analytics", tone: "primary" as const },
    headline: "See your edge in the numbers",
    description:
      "Equity curve, drawdown, and win/loss size breakdown update automatically from every trade you log — so your edge shows up in the data, not just gut feel.",
    visual: <AnalyticsPanel />,
    reverse: false,
  },
  {
    tag: { text: "Insights", tone: "profit" as const },
    headline: "Find the patterns quietly costing you",
    description:
      "Pattern detection flags the setups, days, and emotions where your win rate meaningfully deviates from your average — the habits you'd never spot by scrolling a trade list.",
    visual: <InsightPanel />,
    reverse: true,
  },
  {
    tag: { text: "Dashboard", tone: "primary" as const },
    headline: "Arrange it exactly how you think",
    description:
      "Drag, resize, and rearrange dashboard widgets — performance chart, calendar heatmap, recent trades — into the layout that matches how you actually review your day.",
    visual: <CalendarPanel />,
    reverse: false,
  },
];

export function FeatureStories() {
  return (
    <section id="features" className="mx-auto flex w-full max-w-5xl scroll-mt-20 flex-col gap-24 px-6 pb-24 sm:px-10">
      {STORIES.map((story) => (
        <FeatureStory key={story.tag.text} {...story} />
      ))}
    </section>
  );
}
