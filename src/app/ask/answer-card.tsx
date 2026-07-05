"use client";

import { Card } from "@/components/ui/Card";
import { InsightChart } from "@/app/insights/insight-chart";
import type { AskAnswer } from "@/lib/ask/queries";

export function AnswerCard({ answer }: { answer: AskAnswer }) {
  if (answer.noData) {
    return (
      <Card className="opacity-60">
        <p className="text-sm font-medium text-zinc-500">{answer.headline}</p>
        <p className="mt-1 text-xs text-zinc-400">{answer.subtext}</p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 leading-snug">
        {answer.headline}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{answer.subtext}</p>
      {answer.chart && answer.chart.length >= 2 && (
        <div className="mt-4">
          <InsightChart
            data={answer.chart}
            highlightLabel={answer.highlightLabel ?? ""}
          />
        </div>
      )}
    </Card>
  );
}
