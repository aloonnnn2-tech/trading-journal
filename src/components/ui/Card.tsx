"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { useReveal } from "@/components/motion/use-reveal";

type CardProps = HTMLMotionProps<"div"> & { hoverable?: boolean; standalone?: boolean };

// `standalone` (default true) makes the card animate in as it is scrolled to.
// Set it to false when the card is a direct child of <StaggerGrid>, which
// handles its children's entrance itself.
//
// The entrance used to be a framer `initial: { opacity: 0 }` + `whileInView`,
// which meant every card on every page -- dashboard, analytics, admin --
// shipped invisible in the server HTML and waited for hydration plus a
// scroll-into-view callback before appearing. That is most of why /analytics
// looked blank for a second or two on arrival (issue 4 of
// docs/design-audit.md).
//
// useReveal rather than a <Reveal> wrapper: this is a motion element already,
// and wrapping it would either add a box to every grid cell or need
// `display: contents`, which drops the box a transform needs to apply to.
// The hover lift stays on framer -- it is not an entrance, and the spring
// reads better than a CSS transition.
export function Card({ className = "", hoverable = true, standalone = true, ...props }: CardProps) {
  const ref = useReveal<HTMLDivElement>();

  return (
    <motion.div
      ref={standalone ? ref : undefined}
      data-reveal={standalone ? "up" : undefined}
      whileHover={hoverable ? { y: -1, transition: { duration: 0.15 } } : undefined}
      // Inert in V1; Design V2 uses it to cancel the entrance animation and
      // the hover lift. See design-v2.css section 5.
      data-v2-flat
      className={`rounded-xl border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-5 shadow-[0_1px_2px_rgba(28,27,24,0.05)] transition-colors ${className}`}
      {...props}
    />
  );
}
