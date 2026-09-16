"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

// A number that counts from zero to `to` on mount. The server renders the
// zero state and the spring runs after hydration, so nothing mismatches. The
// motion value is rendered directly as the span's child, which lets framer
// write the text every frame without a React render.
//
// This used to skip the count under a reduced-motion preference and render the
// final figure outright. It no longer does: /home-v2 (the only place this is
// used) animates for everyone by owner decision -- see the motion-policy note
// at the top of HomeV2.tsx. Left un-gated here rather than gated-but-inert so
// there is no dead branch pretending a preference is still honoured.
export function CountUp({
  to,
  format,
  delay = 0,
  duration = 1.4,
  className,
}: {
  to: number;
  format: (value: number) => string;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const raw = useMotionValue(0);
  const spring = useSpring(raw, { duration: duration * 1000, bounce: 0 });
  const text = useTransform(spring, format);

  useEffect(() => {
    const id = setTimeout(() => raw.set(to), delay * 1000);
    return () => clearTimeout(id);
  }, [raw, to, delay]);

  return <motion.span className={className}>{text}</motion.span>;
}
