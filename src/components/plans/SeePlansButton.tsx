"use client";

import { useState } from "react";
import type { PaidFeatureId } from "@/lib/plans/paid-features";
import { PlansPanel } from "./PlansPanel";

// The "See plans" control on every paid-feature upsell. Opens the Plans panel
// in place, rather than linking to the homepage's pricing section -- which a
// signed-in visitor never reaches (the homepage redirects to the dashboard).
export function SeePlansButton({
  feature,
  className = "w-fit text-sm text-primary hover:underline",
  children = "See plans",
}: {
  feature: PaidFeatureId;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-track="see-plans" aria-haspopup="dialog" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <PlansPanel open={open} onClose={() => setOpen(false)} feature={feature} />
    </>
  );
}
