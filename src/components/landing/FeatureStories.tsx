import { FeatureStory } from "@/components/landing/FeatureStory";
import { InsightPanel, CalendarPanel, RulesPanel } from "@/components/landing/illustrations";

// Three stories, alternating.
//
// **It used to be four**, which is most of why the page felt like the same box
// scrolling past. Three is a rhythm; four is a pattern, and a pattern is what
// the eye learns to skip. The variety now comes from the sections around this
// one -- pillars, bento, timeline -- rather than from bending these.
//
// A centred full-width variant was tried here and removed: both panels are
// drawn as proportional SVG, so stretching one to the full measure turned the
// heatmap into oversized blocks and the bar chart into a 320px-tall wall. A
// split gives the panel a column its drawing was designed for AND fills the
// measure, which is what the wide version was reaching for in the first place.
//
// The rules story leads because it is the largest thing the app grew after
// launch, it is FREE, and it is the one capability a trader cannot get from a
// spreadsheet.
//
// **Nothing gated appears here without saying so.** Everything on this page is
// free unless the copy names the paid plan -- the pricing section is where the
// paid features are sold, and a landing page that blurs the line produces
// signups that churn the moment they hit a paywall they did not expect.

const STORIES = [
  {
    tag: { text: "Rules & mistakes", tone: "profit" as const },
    headline: "Hold yourself to your own plan",
    description:
      "Write the rules you actually trade by and every trade gets graded against them. The app also spots a stop you moved, a position you sized up, an exit you took early. Your mistakes end up counted instead of half-remembered. Free on every account.",
    visual: <RulesPanel />,
    reverse: false,
  },
  {
    tag: { text: "Dashboard & goals", tone: "profit" as const },
    headline: "Arrange it exactly how you think",
    description:
      "Arrange the dashboard the way you actually review your day. Set goals too, and they fill in from your trades as you go.",
    visual: <CalendarPanel />,
    reverse: true,
  },
  {
    tag: { text: "Insights", tone: "primary" as const },
    headline: "Find the patterns quietly costing you",
    description:
      "The setups, days and moods where your win rate drifts furthest from your average. Each one shows how many trades it rests on, so you can tell a real pattern from a fluke.",
    visual: <InsightPanel />,
    reverse: false,
  },
];

export function FeatureStories() {
  return (
    <section
      id="features"
      className="mx-auto flex w-full max-w-6xl scroll-mt-20 flex-col gap-24 px-6 pb-24 sm:px-10"
    >
      {STORIES.map((story) => (
        <FeatureStory key={story.tag.text} {...story} />
      ))}
    </section>
  );
}
