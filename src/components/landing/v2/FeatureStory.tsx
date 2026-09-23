"use client";

import { CategoryTag } from "@/components/landing/CategoryTag";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Tilt } from "@/components/landing/v2/Tilt";
import { Reveal } from "@/components/motion/Reveal";

// A feature story: copy beside its product panel, alternating sides. Same
// shape and copy as ../FeatureStory.tsx, which stays untouched. The copy
// still arrives from its own side and the panel from the other, so stories
// that alternate sides alternate direction. The panel keeps its border light
// and its tilt toward the pointer.
//
// What changed: the headline no longer assembles word by word, the copy no
// longer waits 0.3s behind the tag, and the panel no longer wipes in over
// 0.9s from a 100% clip. The wipe was the worst of them -- it is the
// screenshot the story is about, and it spent most of a second as an empty
// box. All of it now renders complete and moves 8px (issue 7 of
// docs/design-audit.md).

interface FeatureStoryProps {
  tag: { text: string; tone: "primary" | "profit" };
  headline: string;
  description: string;
  visual: React.ReactNode;
  reverse?: boolean;
}

export function FeatureStory({ tag, headline, description, visual, reverse = false }: FeatureStoryProps) {
  // Copy sits on the left unless reversed; the visual takes the other side.
  const copySide = reverse ? "right" : "left";
  const visualSide = reverse ? "left" : "right";

  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={`flex flex-col items-start gap-4 ${reverse ? "lg:order-2" : ""}`}>
        <Reveal direction={copySide}>
          <CategoryTag tone={tag.tone}>{tag.text}</CategoryTag>
        </Reveal>
        <Reveal direction={copySide} delay={0.05}>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            {headline}
          </h3>
        </Reveal>
        <Reveal direction={copySide} delay={0.1}>
          <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-lg">{description}</p>
        </Reveal>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>
        <Tilt>
          <Reveal direction={visualSide} className="relative rounded-xl">
            {visual}
            <BorderBeam size={80} duration={7} />
          </Reveal>
        </Tilt>
      </div>
    </div>
  );
}
