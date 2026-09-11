import { FeatureStory } from "@/components/landing/FeatureStory";
import { ProductShotFrame } from "@/components/landing/ProductShotFrame";

// Real screenshots rather than the hand-drawn panels these used to carry.
// Each is a tight crop of a single panel, never a whole page: a page in a
// half-width column renders at roughly 40% scale and turns 13px UI text to
// mush, which is exactly how an earlier attempt at this failed.
//
// The drawings are still in landing/illustrations.tsx. They follow light and
// dark automatically and never go stale, so they stay the fallback if these
// captures drift away from the shipped UI.
const STORY_SIZES = "(max-width: 1024px) 100vw, 620px";

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
