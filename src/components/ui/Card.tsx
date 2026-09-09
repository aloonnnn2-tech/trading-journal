"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { fadeInUp } from "@/components/motion/variants";

type CardProps = HTMLMotionProps<"div"> & { hoverable?: boolean; standalone?: boolean };

// `standalone` (default true) makes the card trigger its own entrance
// animation on scroll into view. Set it to false when the card is a direct
// child of <StaggerGrid> so it inherits the parent's staggered timing
// instead of animating independently.
export function Card({ className = "", hoverable = true, standalone = true, ...props }: CardProps) {
  return (
    <motion.div
      variants={fadeInUp}
      {...(standalone
        ? { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-40px" } }
        : {})}
      whileHover={
        hoverable
          ? { y: -1, transition: { duration: 0.15 } }
          : undefined
      }
      // Inert in V1; Design V2 uses it to cancel the entrance animation and
      // the hover lift. See design-v2.css section 5.
      data-v2-flat
      className={`rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] transition-colors ${className}`}
      {...props}
    />
  );
}
