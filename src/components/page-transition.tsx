"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

// A short fade-in on the incoming page, on client-side navigations only.
//
// It used to be `<AnimatePresence mode="wait">` with a fade-out. That mode
// holds the new page back until the old one has finished leaving, which put
// a fixed ~180ms on top of every navigation -- on a route that had already
// been fetched. On a device with Reduced Motion on, which the dev log shows
// this one has, the fade never even played and the wait was pure cost. Fade
// the new page in; let the old one simply go.
//
// It also used to fade on the initial document load. Framer serialises the
// `initial` state into the HTML, so the server rendered every page at
// opacity 0 and it stayed blank from first paint until React hydrated --
// measured at ~200ms on a warm dev reload, longer cold, on every route. The
// first render now mounts visible; only a pathname change after that gets
// the fade.

// Module-level rather than a ref: it is read during render, which the ref
// rule forbids. False on the server and through hydration (effects have not
// run), so the first client render matches the HTML; true from then on, so
// every later mount -- every navigation -- fades.
let navigatedOnce = false;

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    navigatedOnce = true;
  }, []);

  return (
    <motion.div
      key={pathname}
      initial={navigatedOnce ? { opacity: 0 } : false}
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
