import { redirect } from "next/navigation";
import { TrendingUp, Brain, Scale, Repeat, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAllAnswers, type AskAnswer } from "@/lib/ask/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { AnswerCard } from "./answer-card";
import { Card } from "@/components/ui/Card";

const CATEGORIES: {
  key: AskAnswer["category"];
  label: string;
  icon: LucideIcon;
  chipClass: string;
  description: string;
}[] = [
  {
    key: "performance",
    label: "Performance",
    icon: TrendingUp,
    chipClass: "bg-primary/10 text-primary",
    description: "When and what you trade best.",
  },
  {
    key: "psychology",
    label: "Psychology",
    icon: Brain,
    chipClass: "bg-accent/10 text-accent",
    description: "How emotions affect your results.",
  },
  {
    key: "risk",
    label: "Risk",
    icon: Scale,
    chipClass: "bg-amber-500/10 text-amber-500",
    description: "How your sizing affects outcomes.",
  },
  {
    key: "streaks",
    label: "Streaks",
    icon: Repeat,
    chipClass: "bg-profit/10 text-profit",
    description: "What happens after wins and losses in a row.",
  },
];

export default async function AskPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  const settings = await getUserSettings(supabase, data.user.id);
  const { answers, totalTrades } = await getAllAnswers(supabase, settings.timezone);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Ask Your Journal
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Questions answered by your own trade data — no AI, no API key, just math.
        </p>
      </div>

      {totalTrades < 3 ? (
        <Card className="text-sm text-zinc-500" hoverable={false}>
          Not enough closed trade data yet — close at least 3 trades to unlock these insights.
        </Card>
      ) : (
        CATEGORIES.map((cat) => {
          const catAnswers = answers.filter((a) => a.category === cat.key);
          if (catAnswers.length === 0) return null;
          return (
            <section key={cat.key}>
              <div className="mb-4 flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${cat.chipClass}`}>
                  <cat.icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div>
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-900 dark:text-zinc-50">
                    {cat.label}
                  </h2>
                  <p className="text-xs text-zinc-500">{cat.description}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {catAnswers.map((answer) => (
                  <AnswerCard key={answer.id} answer={answer} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
