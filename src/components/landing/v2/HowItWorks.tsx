"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { Sparkles } from "lucide-react";
import { ConfidenceBadge } from "@/components/ocr/ConfidenceBadge";
import { FIELD_LABELS } from "@/lib/ocr/types";
import { BorderBeam } from "@/components/landing/v2/BorderBeam";
import { CountUp } from "@/components/landing/v2/CountUp";
import exampleScreenshot from "../../../../public/example-trade-screenshot.png";

// The process row for /home-v2: screenshot in, trade card out, execution
// scored. The three cards orbit a vertical axis, continuously: whichever is at
// the front is full size and readable, the two behind it are smaller and
// dimmer, and none of them ever stands still. The orbit is time-warped so a
// card lingers near the front and moves round the back -- each hand-off is
// about a second and a half of movement and a second and a half of holding,
// so one card comes forward every three seconds -- but the warp never reaches
// zero speed, so the cards in the background keep turning between hand-offs. Runs from
// mount, ignores hover and scroll position. The visuals are the app's own UI:
// the OCR dialog's dropzone and scanning state, the "Detected from image"
// panel with the real ConfidenceBadge, and the review card's score block.
// Sits where Three Pillars sat on /; that row and the old timeline said the
// same three things twice.

const STEP_MS = 3000;
const THIRD_TURN = (2 * Math.PI) / 3;
// Horizontal radius of the orbit as a percentage of the card width. At the
// two rear positions (±120°) this puts the cards 36% either side of centre.
const RADIUS_PCT = 41.5;

// Progress through one hand-off, 0..1 -> 0..1. A sigmoid that lingers at the
// ends, blended with a little linear motion so the speed is never zero.
function warp(p: number): number {
  const s = (p * p * p) / (p * p * p + (1 - p) * (1 - p) * (1 - p));
  return 0.85 * s + 0.15 * p;
}

// Matches the example order ticket the OCR dialog itself demonstrates with.
const DETECTED: { key: keyof typeof FIELD_LABELS; value: string; confidence: number }[] = [
  { key: "ticker", value: "AAPL", confidence: 0.96 },
  { key: "direction", value: "Long", confidence: 0.91 },
  { key: "entry_price", value: "192.30", confidence: 0.94 },
  { key: "take_profit", value: "201.50", confidence: 0.9 },
  { key: "stop_loss", value: "188.00", confidence: 0.9 },
  { key: "shares", value: "10", confidence: 0.88 },
];

// The six sub-scores the real review card shows, in its order.
const BREAKDOWN: [string, number][] = [
  ["Setup", 84],
  ["Entry", 82],
  ["Risk", 91],
  ["Exit", 61],
  ["Plan", 75],
  ["Discipline", 70],
];

// The three visuals play their sequence on mount, and each card remounts its
// visual every time it comes to the front, so the step performs itself on
// every hand-off rather than sitting there finished.

function UploadVisual() {
  return (
    <div className="flex h-full items-center gap-5 rounded-xl border-2 border-dashed border-zinc-300 px-5 dark:border-zinc-700">
      <motion.div
        initial={{ opacity: 0, y: -18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22, delay: 0.15 }}
      >
        <Image
          src={exampleScreenshot}
          alt=""
          aria-hidden
          className="h-36 w-auto rounded-md border border-zinc-200 dark:border-zinc-700"
        />
      </motion.div>
      <motion.div
        className="flex min-w-0 flex-col gap-2.5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.55 }}
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-primary" />
        <p className="text-sm text-zinc-500">Reading trade details from image...</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-600">Click, paste, or drag a screenshot here</p>
      </motion.div>
    </div>
  );
}

function DetectedVisual() {
  return (
    <div className="h-full rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="mb-2.5 text-sm font-semibold text-primary">Detected from image</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {DETECTED.map((f, i) => (
          <motion.div
            key={f.key}
            className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
            // Left column from the left, right column from the right.
            initial={{ opacity: 0, x: i % 2 === 0 ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.07, ease: "easeOut" }}
          >
            <span className="text-zinc-500 dark:text-zinc-400">{FIELD_LABELS[f.key]}:</span>
            <span className="font-medium">{f.value}</span>
            <motion.span
              className="inline-flex"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.4 + i * 0.07 }}
            >
              <ConfidenceBadge confidence={f.confidence} />
            </motion.span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ReviewVisual() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-subtle dark:bg-zinc-950">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
        <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        AI Trade Review
      </p>
      <div className="flex items-start gap-5">
        <div className="shrink-0 text-center">
          <p className="text-4xl font-semibold leading-none tabular-nums text-profit">
            <CountUp to={78} format={(v) => String(Math.round(v))} delay={0.1} duration={1.1} />
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">/ 100</p>
        </div>
        <div className="grid min-w-0 flex-1 gap-x-5 gap-y-1.5 pt-1 sm:grid-cols-2">
          {BREAKDOWN.map(([label, value], i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-zinc-500">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <motion.div
                  className="h-full origin-left rounded-full bg-primary"
                  style={{ width: `${value}%` }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 + i * 0.08, ease: "easeOut" }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    number: "01",
    word: "Upload",
    paid: false,
    headline: "Drop in a screenshot",
    body: "Take it from your broker or platform. The app's own reader parses it, and nothing is sent to a third-party AI service.",
    visual: UploadVisual,
  },
  {
    number: "02",
    word: "Extract",
    paid: false,
    headline: "It becomes a trade card",
    body: "Symbol, direction, entry, exit and size are read off the image and filled in for you, each with a confidence mark to check before you save.",
    visual: DetectedVisual,
  },
  {
    number: "03",
    word: "Review",
    paid: true,
    headline: "Get an AI review",
    body: "Every closed trade scored on how it was executed, not on whether it won. A winning trade can still score poorly.",
    visual: ReviewVisual,
  },
];

// The readable face of a card: the demo, then the step's label and copy.
// Shared by the orbiting card and the reduced-motion one so the copy is
// written once. `visualKey` remounts the demo so its sequence replays --
// on every hand-off for the orbit, on every selection for the stepper.
function CardFace({ step, visualKey }: { step: (typeof STEPS)[number]; visualKey: number }) {
  return (
    <>
      <div className="h-44 overflow-hidden">
        <step.visual key={visualKey} />
      </div>

      <div className="mt-5 flex items-baseline gap-2.5">
        <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">{step.number}</span>
        <span className="text-sm font-medium uppercase tracking-[0.18em] text-primary">{step.word}</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            step.paid
              ? "border-primary/40 text-primary"
              : "border-zinc-200 text-zinc-400 dark:border-subtle dark:text-zinc-500"
          }`}
        >
          {step.paid ? "Paid" : "Free"}
        </span>
      </div>

      <h3 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
        {step.headline}
      </h3>

      <p className="mt-2 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-base">
        {step.body}
      </p>
    </>
  );
}

// The card shell's look, shared by both modes so they cannot drift apart.
const CARD_SHELL =
  "flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_16px_48px_-24px_rgba(28,27,24,0.35)] sm:p-7 dark:border-subtle dark:bg-card";

// One card on the orbit. `turns` is the shared clock: how many hand-offs have
// elapsed, fractional between them. Card i sits at angle (i - turns) thirds of
// a circle, so card 0 starts at the front and card 1 comes forward first.
function StackCard({
  index,
  turns,
  step,
}: {
  index: number;
  turns: MotionValue<number>;
  step: (typeof STEPS)[number];
}) {
  const angle = useTransform(turns, (t) => (index - t) * THIRD_TURN);
  // 1 at the front, 0 at the very back.
  const depth = useTransform(angle, (a) => (Math.cos(a) + 1) / 2);
  const x = useTransform(angle, (a) => `${(Math.sin(a) * RADIUS_PCT).toFixed(2)}%`);
  const y = useTransform(depth, (d) => -20 * (1 - d));
  const scale = useTransform(depth, (d) => 0.86 + 0.14 * d);
  const opacity = useTransform(depth, (d) => 0.5 + 0.5 * d);
  const zIndex = useTransform(depth, (d) => Math.round(d * 100));
  // The border light belongs to the card at the front; it fades across as the
  // stack turns rather than jumping.
  const beamOpacity = useTransform(depth, (d) => Math.min(1, Math.max(0, (d - 0.7) / 0.3)));

  // Every arrival at the front remounts the visual so its sequence replays.
  const [arrivals, setArrivals] = useState(0);
  const wasFront = useRef(index === 0);
  useMotionValueEvent(depth, "change", (d) => {
    const isFront = d > 0.9;
    if (isFront && !wasFront.current) setArrivals((n) => n + 1);
    wasFront.current = isFront;
  });

  // A soft light that follows the pointer across the card.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const [hovered, setHovered] = useState(false);
  const spotlight = useMotionTemplate`radial-gradient(320px circle at ${pointerX}px ${pointerY}px, color-mix(in srgb, var(--color-primary) 18%, transparent), transparent 70%)`;

  return (
    <motion.article
      style={{ x, y, scale, opacity, zIndex }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointerX.set(e.clientX - r.left);
        pointerY.set(e.clientY - r.top);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={`absolute inset-0 ${CARD_SHELL}`}
    >
      <motion.div style={{ opacity: beamOpacity }} className="pointer-events-none absolute inset-0 rounded-[inherit]">
        <BorderBeam />
      </motion.div>
      <motion.div
        aria-hidden
        style={{ background: spotlight }}
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
      />
      <CardFace step={step} visualKey={arrivals} />
    </motion.article>
  );
}

export function HowItWorks() {
  const turns = useMotionValue(0);
  const startRef = useRef<number | null>(null);
  const [front, setFront] = useState(0);

  // Deliberately NOT gated on prefers-reduced-motion -- see the note in
  // HomeV2.tsx. The wheel turns for everyone, because on Windows that setting
  // is off by default and Battery Saver switches it off too, so honouring it
  // here meant most visitors never saw this section work at all.
  useAnimationFrame((t) => {
    if (startRef.current === null) startRef.current = t;
    const elapsed = t - startRef.current;
    const whole = Math.floor(elapsed / STEP_MS);
    turns.set(whole + warp((elapsed % STEP_MS) / STEP_MS));
    const now = whole % STEPS.length;
    if (now !== front) setFront(now);
  });

  return (
    <section className="mx-auto w-full max-w-6xl overflow-hidden px-6 pb-24 sm:px-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative mx-auto h-[30rem] w-full max-w-[40rem] sm:h-[24rem]"
      >
        {STEPS.map((step, i) => (
          <StackCard key={step.number} index={i} turns={turns} step={step} />
        ))}
      </motion.div>

      <div aria-hidden className="mt-6 flex justify-center gap-2">
        {STEPS.map((step, i) => (
          <span
            key={step.number}
            className={`h-1.5 w-6 rounded-full transition-colors duration-300 ${
              i === front ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
