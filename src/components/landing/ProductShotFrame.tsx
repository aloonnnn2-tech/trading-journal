import Image from "next/image";

// A real screenshot of the running app, presented as a plate.
//
// **Not mounted in fake browser chrome.** Every competitor draws a window with
// traffic-light dots around theirs, and that is the decorative fake-window
// pattern this redesign removed from the hero once already. A hairline is
// enough; the screenshot is the evidence, not the frame.
//
// **Two files per shot, one per theme.** The app's dark mode is a class that
// next-themes puts on <html>, not the OS preference, so a <picture> with a
// prefers-color-scheme source would disagree with the toggle in the header.
// Both images are rendered and the wrong one is hidden by that same class.
// They are lazy-loaded by default, and a display:none image never intersects
// the viewport, so the hidden theme's file is never fetched -- the cost of
// the pair is one request, not two. The `eager` plate is the one exception.
//
// `quality={95}` rather than the default 75. That default is tuned for
// photographs, where its artifacts hide in noise. These are screenshots of
// 12px UI text and one-pixel rules, where the same artifacts are plainly
// visible as fringing around every glyph. Next 16 requires the value to be
// allow-listed in next.config, or it is silently coerced back to 75.
//
// The sources are captured at 3x. A slot rendered at 560 CSS px needs ~1120
// device pixels on a retina display, and next/image will request a candidate
// far wider than that; capturing at 2x left nothing to serve.

export function ProductShotFrame({
  src,
  srcDark,
  alt,
  width,
  height,
  sizes,
  caption,
  eager = false,
}: {
  /** Light-theme capture. */
  src: string;
  /** Dark-theme capture. Defaults to `src` with a `-dark` suffix. */
  srcDark?: string;
  alt: string;
  width: number;
  height: number;
  /** The real rendered width of this slot, so the browser picks sensibly. */
  sizes: string;
  caption?: string;
  /** Load both theme images immediately instead of lazily. For the one plate
   *  that sits just under the hero and is the page's Largest Contentful
   *  Paint: lazy-loading it made first paint look late, and the cost of
   *  eager here is one extra ~150KB request for the theme not in use. Every
   *  other plate stays lazy so its hidden twin is never fetched. */
  eager?: boolean;
}) {
  const dark = srcDark ?? src.replace(/\.png$/, "-dark.png");

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-subtle">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          quality={95}
          loading={eager ? "eager" : "lazy"}
          className="block w-full dark:hidden"
        />
        <Image
          src={dark}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          quality={95}
          loading={eager ? "eager" : "lazy"}
          className="hidden w-full dark:block"
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{caption}</figcaption>
      )}
    </figure>
  );
}
