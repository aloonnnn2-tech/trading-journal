// Trading Lens logo mark: a dark rounded tile so it reads correctly against
// both light and dark page backgrounds, regardless of theme.
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-mark.png" alt="Trading Lens" className={`${className} rounded-md`} />;
}
