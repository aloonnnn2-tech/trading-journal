// Trading Lens logo mark: a dark rounded tile so it reads correctly against
// both light and dark page backgrounds, regardless of theme.
//
// A 128px copy, not the 512px original: the mark is never shown larger than
// 40px (120px on a 3x phone screen), and the original is 67 KB -- all of the
// sign-in page's image weight -- against 5 KB for this one. The 512px file
// stays for the share images (src/app/_og/share-card.tsx), which draw it big.
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-mark-128.png" alt="Trading Lens" className={`${className} rounded-md`} />;
}
