"use client";

import { useEffect } from "react";

// Last-resort boundary: catches throws from the root layout itself, which
// error.tsx can't (it renders *inside* that layout). Because this replaces
// the root layout, none of its providers -- or its `import "./globals.css"`
// -- are in play, so this deliberately uses inline styles rather than
// Tailwind classes: a page whose whole job is "the layout failed" must not
// depend on the stylesheet having loaded.
//
// It also has to render its own <html> and <body>, per Next's App Router
// contract for this file.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          color: "#18181b",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "24rem",
            padding: "2rem",
            borderRadius: "0.75rem",
            border: "1px solid #e4e4e7",
            backgroundColor: "#ffffff",
          }}
        >
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 600 }}>
            Trading Lens couldn&apos;t start
          </h1>
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#71717a" }}>
            Something failed while loading the app itself. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "0 0 1rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.6875rem",
                color: "#a1a1aa",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#0a9bff",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
