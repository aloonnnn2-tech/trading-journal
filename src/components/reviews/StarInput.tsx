"use client";

import { useRef } from "react";
import { Star } from "lucide-react";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

// 1-5 stars as a radio group: arrow keys move, each star says what it means
// to a screen reader ("4 stars, Very good").
export function StarInput({
  value,
  onChange,
  size = "md",
  label = "Your rating",
}: {
  value: number;
  onChange: (rating: number) => void;
  size?: "md" | "lg";
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const px = size === "lg" ? "h-8 w-8" : "h-6 w-6";

  function move(to: number) {
    const next = Math.min(5, Math.max(1, to));
    onChange(next);
    refs.current[next - 1]?.focus();
  }

  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= value;
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}, ${WORDS[n]}`}
              tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
              onClick={() => onChange(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move((value || 0) + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move((value || 2) - 1);
                }
              }}
              className="rounded-md p-0.5 outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Star
                className={`${px} ${on ? "fill-amber-400 text-amber-400" : "text-zinc-300 dark:text-zinc-600"}`}
                strokeWidth={1.75}
              />
            </button>
          );
        })}
      </div>
      {value > 0 && <span className="text-sm text-zinc-600 dark:text-zinc-400">{WORDS[value]}</span>}
    </div>
  );
}

/** Read-only stars for display (homepage, admin). */
export function Stars({ rating, className = "h-4 w-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`${className} ${n <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300 dark:text-zinc-600"}`}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}
