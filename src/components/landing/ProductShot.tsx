"use client";

import { motion } from "framer-motion";
import { ProductShotFrame } from "@/components/landing/ProductShotFrame";

// The first real screenshot on the page, immediately after the hero.
//
// It used to be the dashboard, and that was the wrong choice: every product in
// this category has a dashboard, so a picture of one proves the app exists
// without saying why it is worth switching to. "Find My Edge" ranks every way
// of cutting a trading history by expectancy and shows the trade count behind
// each figure. None of the competitors in the research pass show anything like
// it, which is the whole reason it earns the largest slot on the page.
//
// The caption naming the demo account is deliberate. The figures are seeded
// rather than a real person's P/L, and saying so costs nothing next to being
// caught implying otherwise.

export function ProductShot() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <ProductShotFrame
          src="/screenshots/edge.png"
          alt="The Find My Edge panel: strongest edges on the left ranked by expectancy in R, biggest leaks on the right. Each row shows the trade count and total R behind the figure."
          width={3732}
          height={1494}
          sizes="(max-width: 1152px) 100vw, 1152px"
          priority
          caption="Find My Edge, captured from the app. Figures come from the demo account, so they are seeded rather than anyone’s real trading history."
        />
      </motion.div>
    </section>
  );
}
