"use client";

import { motion } from "framer-motion";

// The one reveal used on /home-v2 for anything the shared sections do not
// already animate. Same parameters as ThreePillars, so new and existing
// reveals read as one motion. An in-flow div with no box of its own: it can
// change what you see, never how tall the page is.
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
