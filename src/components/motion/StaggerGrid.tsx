import type { HTMLAttributes } from "react";

// The stat grid at the top of /dashboard, /analytics and the admin pages.
//
// This used to be a `motion.div` running a stagger container: every child
// Card started at `opacity: 0` in the server HTML and was faded in 60ms after
// the one before it. On /analytics that is a six-up grid, so the last tile
// arrived a third of a second after the first -- on top of the wait for five
// Supabase round-trips, which is what made the page read as blank on arrival
// (issue 4 of docs/design-audit.md).
//
// Stat tiles now render with their figures in them, full stop. There is
// nothing here worth animating: the reader came to this page to read these
// numbers, and they are the first thing on it. Charts still animate, and
// cards further down the page still reveal as they are scrolled to, through
// src/components/motion/use-reveal.ts.
//
// Kept as a component rather than deleted so the grid's call sites, and the
// `standalone={false}` contract with Card, stay where they are.
export function StaggerGrid({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className} {...props} />;
}
