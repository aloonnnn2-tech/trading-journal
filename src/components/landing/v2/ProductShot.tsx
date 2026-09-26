"use client";

import Image from "next/image";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";

// The Find My Edge plate for /home-v2. Same image, copy and caption as
// ../ProductShot.tsx, and the same frame as ../ProductShotFrame.tsx -- the
// hairline, the light/dark pair, quality 95, eager because it is the page's
// largest paint -- inlined here rather than imported so the border light can
// sit inside the rounded image box instead of round the caption.

const SRC = "/screenshots/edge.png";
const ALT =
  "The Find My Edge panel: strongest edges on the left ranked by expectancy in R, biggest leaks on the right. Each row shows the trade count and total R behind the figure.";
const WIDTH = 3732;
const HEIGHT = 1494;
const SIZES = "(max-width: 1152px) 100vw, 1152px";

// Its entrance is the hero's CSS rise, not the scroll Reveal the sections
// below use. This plate sits at or just under the fold on arrival, and the
// Reveal rule is that anything that close is shown outright and never moves
// -- which is right for not leaving it blank, and meant the first thing under
// the hero never animated for anyone. A CSS animation starts at first paint,
// before any script, so it can move without ever being blank: the same
// reason the hero uses it. 150ms in, so it lands just after the hero panel.
// Stilled by the reduced-motion rule in globals.css like every animate-*.
// The trade-off: where the plate is far below the fold (a phone), it has
// finished before anyone scrolls to it, so there it simply appears.
export function ProductShot() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 sm:px-10">
      <figure className="relative m-0 animate-rise" style={{ animationDelay: "150ms" }}>
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
          <Image
            src={SRC}
            alt={ALT}
            width={WIDTH}
            height={HEIGHT}
            sizes={SIZES}
            quality={95}
            loading="eager"
            className="block w-full dark:hidden"
          />
          <Image
            src={SRC.replace(/\.png$/, "-dark.png")}
            alt={ALT}
            width={WIDTH}
            height={HEIGHT}
            sizes={SIZES}
            quality={95}
            loading="eager"
            className="hidden w-full dark:block"
          />
          <BorderBeam size={90} duration={8} />
        </div>
        <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Find My Edge, captured from the app. Figures come from the demo account, so they are seeded rather than anyone’s real trading history.
        </figcaption>
      </figure>
    </section>
  );
}
