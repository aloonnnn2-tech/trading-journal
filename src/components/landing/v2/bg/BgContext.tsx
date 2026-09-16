"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { BgVariant } from "@/components/landing/v2/bg/variants";

// The chosen ground, shared by the background layer and the switcher.
// `setBackground` mirrors the choice into `?bg=` so any variant is a link.
const BgCtx = createContext<{ background: BgVariant; setBackground: (v: BgVariant) => void }>({
  background: "dots",
  setBackground: () => {},
});

export function BgProvider({ initial, children }: { initial: BgVariant; children: React.ReactNode }) {
  const [background, set] = useState<BgVariant>(initial);
  const setBackground = useCallback((v: BgVariant) => {
    set(v);
    const url = new URL(window.location.href);
    url.searchParams.set("bg", v);
    window.history.replaceState(null, "", url);
  }, []);
  return <BgCtx.Provider value={{ background, setBackground }}>{children}</BgCtx.Provider>;
}

export function useBackground() {
  return useContext(BgCtx);
}
