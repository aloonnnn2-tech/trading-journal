import Image from "next/image";

// A real screenshot of the running app, presented as a plate.
//
// **Not mounted in fake browser chrome.** Every competitor draws a window with
// traffic-light dots around theirs, and that is the decorative fake-window
// pattern this redesign removed from the hero once already. A hairline is
// enough; the screenshot is the evidence, not the frame.
//
// `quality={95}` rather than the default 75. That default is tuned for
// photographs, where its artifacts hide in noise. These are screenshots of
// 12px UI text and one-pixel rules, where the same artifacts are plainly
// visible as fringing around every glyph.
//
// The sources are captured at 3x. A slot rendered at 560 CSS px needs ~1120
// device pixels on a retina display, and next/image will request a candidate
// far wider than that; capturing at 2x left nothing to serve and the browser
// got an upscale.

export function ProductShotFrame({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** The real rendered width of this slot, so the browser picks sensibly. */
  sizes: string;
  priority?: boolean;
  caption?: string;
}) {
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
          priority={priority}
          className="block w-full"
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{caption}</figcaption>
      )}
    </figure>
  );
}
