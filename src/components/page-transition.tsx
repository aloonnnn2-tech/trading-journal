"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

// AnimatePresence lets the outgoing page play an exit animation before the
// incoming one mounts, which a key-remount + CSS-keyframe approach can't do.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        // Inert in V1. Design V2 drops the page transition entirely, and
        // framer-motion writes transform/opacity onto the style attribute
        // where only !important can reach it -- see design-v2.css section 5.
        data-v2-flat
        className="flex flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
