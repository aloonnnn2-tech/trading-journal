"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";

// A headline that arrives a word at a time -- blur, rise, settle -- when it
// scrolls into view. Framer rather than CSS here because these live below
// the fold, where waiting for hydration costs nothing and `once` is wanted.
export function Words({ text, delay = 0, step = 0.06 }: { text: string; delay?: number; step?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          {i > 0 && " "}
          <motion.span
            className="inline-block"
            initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: delay + i * step, ease: "easeOut" }}
          >
            {word}
          </motion.span>
        </Fragment>
      ))}
    </>
  );
}
