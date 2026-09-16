"use client";

import { motion } from "framer-motion";

// A point of blue light that travels round the border of its parent, trailing
// a short gradient. The parent needs `relative` and a border radius; the ring
// inherits it. The mask keeps only the 1px border of this overlay visible --
// two opaque layers, one clipped to the padding box, composited with
// `exclude` -- and the light itself rides a CSS offset-path shaped like the
// box. Written from Magic UI's border-beam. Longhands only: the `mask`
// shorthand resets mask-composite, and Tailwind orders the two utilities so
// the shorthand would win. Unprefixed on purpose, since Lightning CSS drops
// hand-written -webkit- pairs here.
export function BorderBeam({
  size = 60,
  duration = 6,
  delay = 0,
  className = "",
}: {
  size?: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-image:linear-gradient(#000_0_0),linear-gradient(#000_0_0)] [mask-clip:padding-box,border-box] [mask-composite:exclude] ${className}`}
    >
      <motion.div
        className="absolute aspect-square bg-gradient-to-l from-primary via-accent to-transparent"
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)` }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: ["0%", "100%"] }}
        transition={{ repeat: Infinity, ease: "linear", duration, delay: -delay }}
      />
    </div>
  );
}
