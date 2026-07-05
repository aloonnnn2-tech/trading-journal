export function SectionHeadline({
  kicker,
  children,
}: {
  kicker?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 pb-14 sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        {kicker && (
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{kicker}</span>
        )}
        <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          {children}
        </h2>
      </div>
    </div>
  );
}
