// A ticker. Two copies of the children sit side by side and the pair slides
// left by exactly one copy's width, so the loop has no seam. Pauses while the
// pointer is over it, and fades out at both ends so the strip reads as
// passing through rather than being cut off.
export function Marquee({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`group flex w-full overflow-hidden [--gap:1rem] [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] ${className}`}
    >
      {[0, 1].map((copy) => (
        <div
          key={copy}
          aria-hidden={copy === 1}
          className="flex shrink-0 animate-marquee items-center gap-[var(--gap)] pr-[var(--gap)] group-hover:[animation-play-state:paused]"
        >
          {children}
        </div>
      ))}
    </div>
  );
}
