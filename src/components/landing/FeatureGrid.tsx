import { NotebookPen, History, ArrowLeftRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { StaggerGrid } from "@/components/motion/StaggerGrid";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: NotebookPen,
    title: "Full Trade Tracker",
    description:
      "Log every trade with entry/exit price, size, stop loss, and take profit. Autosave keeps it all in sync as you type.",
  },
  {
    icon: History,
    title: "Full Version History",
    description:
      "Every edit to a trade is snapshotted automatically, so you can always see what changed and roll back if needed.",
  },
  {
    icon: ArrowLeftRight,
    title: "Import & Export Anywhere",
    description:
      "Bring in trades from CSV, Excel, or JSON, and export the same way — your data is never locked in.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 pb-24 sm:px-10">
      <StaggerGrid className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title} standalone={false} className="flex flex-col gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <feature.icon className="h-5 w-5" strokeWidth={2} />
            </span>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{feature.title}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{feature.description}</p>
          </Card>
        ))}
      </StaggerGrid>
    </section>
  );
}
