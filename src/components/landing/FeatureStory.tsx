"use client";

import { motion } from "framer-motion";
import { fadeInUp } from "@/components/motion/variants";
import { CategoryTag } from "@/components/landing/CategoryTag";

interface FeatureStoryProps {
  tag: { text: string; tone: "primary" | "profit" };
  headline: string;
  description: string;
  visual: React.ReactNode;
  reverse?: boolean;
}

export function FeatureStory({ tag, headline, description, visual, reverse = false }: FeatureStoryProps) {
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
    >
      <div className={`flex flex-col items-start gap-4 ${reverse ? "lg:order-2" : ""}`}>
        <CategoryTag tone={tag.tone}>{tag.text}</CategoryTag>
        <h3 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {headline}
        </h3>
        <p className="text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-lg">{description}</p>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </motion.div>
  );
}
