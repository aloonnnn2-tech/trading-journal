export function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      tabIndex={0}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-400 dark:border-zinc-600 text-[10px] leading-none text-zinc-500 dark:text-zinc-400"
    >
      ?
    </span>
  );
}
