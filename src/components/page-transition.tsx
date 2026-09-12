"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

// A short fade-in on the incoming page. There is deliberately no exit
// animation and no AnimatePresence any more.
//
// It used to be `<AnimatePresence mode="wait">` with a fade-out. That mode
// holds the new page back until the old one has finished leaving, which put
// a fixed ~180ms on top of every navigation -- on a route that had already
// been fetched. On a device with Reduced Motion on, which the dev log shows
// this one has, the fade never even played and the wait was pure cost. Fade
// the new page in; let the old one simply go.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      // Inert in V1. Design V2 uses it to make sure no hover transform ever
      // lands on the page wrapper; see design-v2-refined.css.
      data-v2-flat
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
