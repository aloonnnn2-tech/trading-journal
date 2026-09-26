import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The link-preview card: what Facebook, X, LinkedIn, Slack and iMessage show
// when someone pastes the site. Issue 10 of docs/design-audit.md -- there was
// none, so a shared link rendered as a bare URL or whatever the crawler
// scraped off the page.
//
// Drawn by next/og (Satori), which lays out a small CSS subset: every element
// with more than one child needs display:flex, and fonts must be handed over
// as files -- next/font does not reach in here. The two .woff subsets beside
// this file are the site's own faces, from @fontsource, under the OFL
// licences alongside them.
//
// Deliberately says nothing the homepage does not already say, and carries
// no numbers: it is the page's own headline, eyebrow and name, nothing more.
// This is built once at compile time (no request-time APIs are touched), so
// reading from the source tree is safe.

export const SHARE_CARD_SIZE = { width: 1200, height: 630 };
export const SHARE_CARD_ALT =
  "Trading Lens. Free, no credit card. See the pattern behind every trade.";

// The spec's tokens (docs/design-audit.md, "Design tokens").
const BG = "#101010";
const INK = "#ECEAE4";
const ACCENT = "#4D8EF7";
const MUTED = "#8A8983";

// The same recessive chart line the closing CTA draws, so the card and the
// page share a motif.
const LINE =
  "0,140 60,128 120,134 180,112 240,120 300,96 360,104 420,82 480,90 540,64 600,72 660,44 720,52 800,24";

// Exactly one word in accent, per the spec: headlines colour one keyword.
const HEADLINE = ["See", "the", "pattern", "behind", "every", "trade."];

const here = (...parts: string[]) => join(process.cwd(), "src", "app", "_og", ...parts);

export async function renderShareCard(): Promise<ImageResponse> {
  const [interBold, geistMono, mark] = await Promise.all([
    readFile(here("fonts", "inter-latin-700-normal.woff")),
    readFile(here("fonts", "geist-mono-latin-500-normal.woff")),
    readFile(join(process.cwd(), "public", "brand-mark.png")),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: "64px 72px",
          position: "relative",
          fontFamily: "Inter",
        }}
      >
        <svg
          width="1200"
          height="240"
          viewBox="0 0 800 160"
          preserveAspectRatio="none"
          style={{ position: "absolute", left: 0, bottom: 0, opacity: 0.14 }}
        >
          <polyline points={LINE} fill="none" stroke={ACCENT} strokeWidth="3" strokeLinejoin="round" />
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markSrc} width={56} height={56} style={{ borderRadius: 12 }} alt="" />
          <span style={{ fontSize: 34, color: INK, letterSpacing: -0.5 }}>Trading Lens</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <span
            style={{
              fontFamily: "Geist Mono",
              fontSize: 22,
              color: ACCENT,
              letterSpacing: 5,
            }}
          >
            FREE · NO CREDIT CARD
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              maxWidth: 980,
              fontSize: 82,
              lineHeight: 1.04,
              letterSpacing: -1.6,
              color: INK,
            }}
          >
            {HEADLINE.map((word, i) => (
              <span
                key={word}
                style={{
                  color: word === "pattern" ? ACCENT : INK,
                  marginRight: i < HEADLINE.length - 1 ? 22 : 0,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>

        <span style={{ fontFamily: "Geist Mono", fontSize: 20, color: MUTED }}>
          tradinglenz.netlify.app
        </span>
      </div>
    ),
    {
      ...SHARE_CARD_SIZE,
      fonts: [
        { name: "Inter", data: interBold, style: "normal", weight: 700 },
        { name: "Geist Mono", data: geistMono, style: "normal", weight: 500 },
      ],
    },
  );
}
