"use client";

import { motion } from "framer-motion";
import { Words } from "@/components/landing/v2/Words";

// The centred section headline for /home-v2: the kicker rises, the heading
// arrives word by word. Same markup as ../SectionHeadline.tsx otherwise.
export function SectionHeadline({ kicker, children }: { kicker?: string; children: string }) {
  return (
    <div className="px-6 pb-14 sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        {kicker && (
          <motion.span
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary"
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {kicker}
          </motion.span>
        )}
        <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          <Words text={children} delay={0.1} />
        </h2>
      </div>
    </div>
  );
}
