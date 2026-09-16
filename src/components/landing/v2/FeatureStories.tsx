import { FeatureStory } from "@/components/landing/v2/FeatureStory";
import { ProductShotFrame } from "@/components/landing/ProductShotFrame";

// The three feature stories for /home-v2: same screenshots, copy and order
// as ../FeatureStories.tsx (which stays untouched), rendered through the v2
// story so each can move. Real screenshots, tight crops, alternating sides,
// nothing gated appears without saying so -- see the original for why.

const STORY_SIZES = "(max-width: 1024px) 100vw, 620px";

const STORIES = [
  {
    tag: { text: "Rules & mistakes", tone: "profit" as const },
    headline: "Hold yourself to your own plan",
    description:
      "Write the rules you actually trade by and every trade gets graded against them. The app also spots a stop you moved, a position you sized up, an exit you took early. Your mistakes end up counted instead of half-remembered. Free on every account.",
    visual: (
      <ProductShotFrame
        src="/screenshots/plan.png"
        alt="The Plan Adherence panel on a closed trade: the Earnings Gap Fade strategy scored 2 of 3, with the risk rule marked broken because 0.73 percent was risked against a 0.5 percent limit."
        width={1908}
        height={552}
        sizes={STORY_SIZES}
      />
    ),
    reverse: false,
  },
  {
    tag: { text: "MAE / MFE", tone: "profit" as const },
    headline: "See the heat you sat through",
    description:
      "How far each trade moved against you after entry, and how far it ran in your favour before you closed it. That is the difference between a stop set too tight and a thesis that was wrong, and a profit and loss column cannot tell you which one you are looking at.",
    visual: (
      <ProductShotFrame
        src="/screenshots/excursion.png"
        alt="The MAE and MFE panel: average adverse excursion of -2.47 percent, average favourable excursion of +3.55 percent, and a 39 percent median capture rate across 132 measured trades."
        width={1992}
        height={699}
        sizes={STORY_SIZES}
      />
    ),
    reverse: true,
  },
  {
    tag: { text: "Insights", tone: "primary" as const },
    headline: "Find the patterns that cost you",
    description:
      "The setups, days and moods where your win rate drifts furthest from your average. Each one shows how many trades it rests on, so you can tell a real pattern from a fluke.",
    visual: (
      <ProductShotFrame
        src="/screenshots/mistakes.png"
        alt="The Mistakes panel: recurring errors across 327 closed trades, each showing expectancy with that mistake against every other trade."
        width={1992}
        height={1347}
        sizes={STORY_SIZES}
      />
    ),
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
