"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

// Text that types itself when it scrolls into view, with a caret that blinks
// while typing and disappears when done. The full string is rendered
// invisibly underneath so the element is its final width from the start and
// nothing around it shifts.
export function Typewriter({ text, delay = 0, perChar = 45 }: { text: string; delay?: number; perChar?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let i = 0;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setCount(i);
      if (i < text.length) id = setTimeout(tick, perChar);
    };
    id = setTimeout(tick, delay * 1000);
    return () => clearTimeout(id);
  }, [inView, text, delay, perChar]);

  const done = count >= text.length;

  return (
    <span ref={ref} className="relative inline-block">
      <span className="invisible" aria-hidden>
        {text}
      </span>
      <span className="absolute inset-0 whitespace-nowrap">
        {text.slice(0, count)}
        {!done && inView && <span className="ml-px inline-block h-[0.9em] w-[2px] animate-pulse bg-primary align-middle" />}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
