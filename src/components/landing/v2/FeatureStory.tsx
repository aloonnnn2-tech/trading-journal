"use client";

import { motion } from "framer-motion";
import { CategoryTag } from "@/components/landing/CategoryTag";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { Slide } from "@/components/landing/v2/Slide";
import { Tilt } from "@/components/landing/v2/Tilt";
import { Words } from "@/components/landing/v2/Words";

// A feature story for /home-v2: copy beside its product panel, alternating
// sides. Same shape and copy as ../FeatureStory.tsx, which stays untouched.
// What moves: the copy slides in from its own side, the screenshot from its
// side with a wipe that runs toward the copy, the headline arrives word by
// word, and the screenshot carries a light round its border and tilts toward
// the pointer. Because the stories alternate sides, they alternate direction.

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
  // Hidden edge is the one away from the copy, so the wipe travels toward it.
  const hidden = reverse ? "inset(0 100% 0 0 round 12px)" : "inset(0 0 0 100% round 12px)";

  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={`flex flex-col items-start gap-4 ${reverse ? "lg:order-2" : ""}`}>
        <Slide from={copySide}>
          <CategoryTag tone={tag.tone}>{tag.text}</CategoryTag>
        </Slide>
        <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          <Words text={headline} delay={0.1} />
        </h3>
        <Slide from={copySide} delay={0.3}>
          <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-lg">{description}</p>
        </Slide>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>
        <Tilt>
          <motion.div
            className="relative rounded-xl"
            initial={{ clipPath: hidden, x: visualSide === "left" ? -24 : 24, opacity: 0.6 }}
            whileInView={{ clipPath: "inset(0 0 0 0 round 12px)", x: 0, opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
          >
            {visual}
            <BorderBeam size={80} duration={7} />
          </motion.div>
        </Tilt>
      </div>
    </div>
  );
}
