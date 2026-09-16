"use client";

import { motion } from "framer-motion";

// The one scroll-in entrance for /home-v2's below-the-fold sections, and the
// rule for its direction: a thing on the left of the page comes in from the
// left, a thing on the right from the right, a centred thing rises. Sections
// that alternate sides therefore alternate direction by construction.
const FROM = {
  left: { x: -24, y: 0 },
  right: { x: 24, y: 0 },
  up: { x: 0, y: 16 },
};

export function Slide({
  from,
  delay = 0,
  className,
  children,
}: {
  from: keyof typeof FROM;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, ...FROM[from] }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
