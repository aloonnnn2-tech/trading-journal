"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

// A card that tilts a few degrees toward the pointer and springs flat when it
// leaves. Capped at ±6°, which is enough to read as depth without turning the
// screenshot into a parallax toy.
export function Tilt({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateY = useSpring(useTransform(px, [0, 1], [-6, 6]), { stiffness: 200, damping: 20 });
  const rotateX = useSpring(useTransform(py, [0, 1], [6, -6]), { stiffness: 200, damping: 20 });

  return (
    <motion.div
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
