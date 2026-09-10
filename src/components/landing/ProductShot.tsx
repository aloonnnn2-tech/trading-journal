"use client";

import Image from "next/image";
import { motion } from "framer-motion";

// A real screenshot of the running app, immediately after the hero.
//
// Every competitor homepage leads with an actual screenshot of the product;
// this one led with a hand-drawn illustration of it. The illustration is a
// good drawing, but a drawing is a claim about the app rather than evidence
// of it, and a visitor deciding whether to sign up is looking for evidence.
//
// **Not framed in fake browser chrome.** The competitors all mount their
// screenshots in a drawn window with traffic-light dots, and that is the
// decorative fake-window pattern this redesign already removed once. A real
// screenshot needs no costume: a hairline, a shadowless plate, and a caption
// saying what it is and where the numbers came from.
//
// The caption naming the demo account is deliberate. The figures are seeded
// rather than a real person's P/L, and saying so costs nothing next to being
// caught implying otherwise.

export function ProductShot() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <motion.figure
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="m-0"
      >
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
          <Image
            src="/screenshots/dashboard-home.png"
            alt="The Trading Lens dashboard: account cash, today's profit and loss, open and closed trade counts, win rate, and an equity curve running up and to the right across the period."
            width={2800}
            height={1460}
            sizes="(max-width: 1152px) 100vw, 1152px"
            priority
            className="block w-full"
          />
        </div>
        <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          The dashboard, captured from the app. Figures come from the demo account, so they are
          seeded rather than anyone&rsquo;s real trading history.
        </figcaption>
      </motion.figure>
    </section>
  );
}
