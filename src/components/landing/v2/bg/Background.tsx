"use client";

import { motion } from "framer-motion";
import { useBackground } from "@/components/landing/v2/bg/BgContext";

// The ground under /home-v2, one layer per variant. All of them sit at the
// page root, absolutely positioned behind everything, inert to the pointer,
// and none affects layout. Lines, dots and grain are neutral -- zinc in light
// mode, white in dark -- at a few percent; the only colour is the existing
// blue, and only where a variant is about tone.

// Textures are full-page but strongest behind the hero: a mask keeps them at
// full strength for the first 48rem and eases them to roughly a third below.
const FADE = "[mask-image:linear-gradient(180deg,#000_0,#000_48rem,rgba(0,0,0,0.35)_100%)]";
const LAYER = "pointer-events-none absolute inset-0 -z-10 overflow-x-clip";

function Grid() {
  return (
    <div
      aria-hidden
      className={`${LAYER} ${FADE} text-zinc-900/[0.07] dark:text-white/[0.06] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]`}
    />
  );
}

function Dots() {
  return (
    <div
      aria-hidden
      className={`${LAYER} ${FADE} text-zinc-900/[0.14] dark:text-white/[0.11] [background-image:radial-gradient(currentColor_1px,transparent_1.5px)] [background-size:24px_24px]`}
    />
  );
}

// Price lines every 64px, and one equity curve across the hero that draws
// itself once. The app's own subject as texture.
const CURVE =
  "M0 330 L110 300 L200 318 L290 262 L380 284 L470 226 L560 248 L650 190 L740 214 L830 160 L920 178 L1010 120 L1100 142 L1190 88 L1280 104 L1370 60 L1440 72";

function Chart() {
  return (
    <div aria-hidden className={LAYER}>
      <div
        className={`absolute inset-0 ${FADE} text-zinc-900/[0.06] dark:text-white/[0.05] [background-image:linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:100%_64px]`}
      />
      <svg
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-24 h-[28rem] w-full"
      >
        <motion.path
          d={`${CURVE} L1440 400 L0 400 Z`}
          fill="var(--color-primary)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.05 }}
          transition={{ duration: 0.8, delay: 2.2 }}
        />
        <motion.path
          d={CURVE}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          strokeOpacity="0.28"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.4, delay: 0.3, ease: "easeInOut" }}
        />
      </svg>
    </div>
  );
}

// Film grain over a soft vignette. Two grains, one for each theme: white
// grain vanishes on a white page and black grain on a dark one.
const grain = (rgb: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0 ${rgb} 0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  )}")`;

const GRAIN_LIGHT = grain("0");
const GRAIN_DARK = grain("1");

function Noise() {
  return (
    <div aria-hidden className={LAYER}>
      <div className="absolute inset-0 bg-repeat opacity-[0.16] dark:hidden" style={{ backgroundImage: GRAIN_LIGHT }} />
      <div className="absolute inset-0 hidden bg-repeat opacity-[0.09] dark:block" style={{ backgroundImage: GRAIN_DARK }} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.06)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.6)_100%)]" />
    </div>
  );
}

// A vertical tone: blue-black at the top easing to the page ground by the
// fold, and a little darkening at the sides. Depth without a light source.
function Tint() {
  return (
    <div aria-hidden className={LAYER}>
      <div className="absolute inset-x-0 top-0 h-[56rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-primary)_12%,var(--background)),var(--background))]" />
      <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(0,0,0,0.35),transparent_22%,transparent_78%,rgba(0,0,0,0.35))] dark:block" />
    </div>
  );
}

// Thin curves across the hero with a gradient travelling along each -- the
// Aceternity background-beams idea, drawn natively. The base curve is a
// hairline; the light is a second copy stroked with a moving gradient.
const BEAMS = [
  { d: "M-60 120 C 360 40, 720 260, 1500 140", dur: 7, delay: 0 },
  { d: "M-60 210 C 300 300, 800 90, 1500 230", dur: 9, delay: 1.2 },
  { d: "M-60 300 C 420 200, 900 420, 1500 320", dur: 8, delay: 2.6 },
  { d: "M-60 400 C 260 320, 760 520, 1500 410", dur: 10, delay: 0.8 },
  { d: "M-60 480 C 480 560, 1000 380, 1500 500", dur: 8.5, delay: 3.4 },
  { d: "M-60 560 C 320 480, 880 640, 1500 580", dur: 9.5, delay: 1.9 },
  { d: "M-60 640 C 500 700, 1000 560, 1500 660", dur: 11, delay: 4.1 },
];

function Beams() {
  return (
    <div aria-hidden className={`${LAYER} [mask-image:linear-gradient(180deg,#000_60%,transparent_100%)]`}>
      <svg
        viewBox="0 0 1440 760"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-0 h-[48rem] w-full text-zinc-900/[0.08] dark:text-white/[0.07]"
      >
        <defs>
          {BEAMS.map((b, i) => (
            <motion.linearGradient
              key={i}
              id={`beam-${i}`}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: "-30%", x2: "-10%" }}
              animate={{ x1: ["-30%", "110%"], x2: ["-10%", "130%"] }}
              transition={{ duration: b.dur, delay: b.delay, repeat: Infinity, ease: "linear" }}
            >
              <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0" />
              <stop offset="0.5" stopColor="var(--color-primary)" stopOpacity="0.9" />
              <stop offset="0.75" stopColor="var(--color-accent)" stopOpacity="0.6" />
              <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
            </motion.linearGradient>
          ))}
        </defs>
        {BEAMS.map((b, i) => (
          <path key={`base-${i}`} d={b.d} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {BEAMS.map((b, i) => (
          <path key={`light-${i}`} d={b.d} fill="none" stroke={`url(#beam-${i})`} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

export function Background() {
  const { background } = useBackground();
  switch (background) {
    case "grid":
      return <Grid />;
    case "dots":
      return <Dots />;
    case "chart":
      return <Chart />;
    case "noise":
      return <Noise />;
    case "tint":
      return <Tint />;
    case "beams":
      return <Beams />;
    case "plain":
      return null;
  }
}
