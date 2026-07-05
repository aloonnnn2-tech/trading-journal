interface CategoryTagProps {
  children: React.ReactNode;
  tone?: "primary" | "profit";
}

export function CategoryTag({ children, tone = "primary" }: CategoryTagProps) {
  const toneClasses =
    tone === "profit"
      ? "border-profit/30 bg-profit/10 text-profit"
      : "border-primary/30 bg-primary/10 text-primary";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${toneClasses}`}
    >
      {children}
    </span>
  );
}
