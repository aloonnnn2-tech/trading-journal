// Logo mark: three candlesticks stepping upward inside a rounded tile.
// Drawn by hand so it stays crisp at 16–32px and inherits the theme accent.
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" className="fill-primary" />
      {/* wicks */}
      <path d="M6.5 8.5v9M12 5.5v8.5M17.5 4v7.5" stroke="white" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      {/* bodies */}
      <rect x="4.9" y="10.5" width="3.2" height="5" rx="1" fill="white" />
      <rect x="10.4" y="7.5" width="3.2" height="4.6" rx="1" fill="white" fillOpacity="0.82" />
      <rect x="15.9" y="5.5" width="3.2" height="4.2" rx="1" fill="white" />
    </svg>
  );
}
