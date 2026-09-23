"use client";

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { useReveal, type RevealDirection } from "@/components/motion/use-reveal";

// The one scroll entrance on this site. CSS transitions, not framer-motion:
// the whole point is that the server HTML carries no opacity, and a
// `motion.div` with an `initial` always writes one. The mechanism is in
// use-reveal.ts; this is the element wrapper around it.
//
// The motion is deliberately small: 200ms, 8px. Long slides and stacked
// staggers are what made the page feel like it was still loading while you
// were reading it (issue 7 of docs/design-audit.md).
export function Reveal({
  children,
  direction = "up",
  delay = 0,
  className,
  as: Tag = "div" as ElementType,
  ...rest
}: {
  children: ReactNode;
  /** Which way the element travels the 8px. Defaults to rising. */
  direction?: RevealDirection;
  /** Seconds. Keep small; a delay is time the reader spends looking at nothing. */
  delay?: number;
  className?: string;
  /** Rendered element, for when a div would be invalid markup (e.g. a list item). */
  as?: ElementType;
  // Anything else -- pointer handlers, aria, id -- lands on the element, so a
  // Reveal can take the place of the element it wraps rather than adding a
  // box around it and changing the layout.
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "style">) {
  const ref = useReveal<HTMLElement>();

  return (
    <Tag
      ref={ref}
      data-reveal={direction}
      className={className}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
