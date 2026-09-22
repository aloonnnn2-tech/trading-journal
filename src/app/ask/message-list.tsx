"use client";

import { Database, PauseCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { AnswerText } from "./answer-text";
import { describeActivity } from "@/lib/chat/labels";
import type { TurnView } from "@/lib/chat/fold";
import type { StreamPhase } from "./use-chat-stream";

export function MessageList({
  turns,
  phase,
  providerLabel,
  needsContinue,
  onKeepGoing,
  onResume,
}: {
  turns: TurnView[];
  phase: StreamPhase;
  providerLabel: string;
  /** The last turn stopped before an answer; offer to pick it up. */
  needsContinue: boolean;
  onKeepGoing: () => void;
  onResume: () => void;
}) {
  if (turns.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {turns.map((turn, i) => {
        const isLast = i === turns.length - 1;
        const names = turn.activity.map((a) => a.name);
        return (
          <div key={turn.user.id} className="flex flex-col gap-3">
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100">
                {turn.user.content}
              </p>
            </div>

            {/* While a round is running and no text has arrived yet, say what
                is happening -- a blank card reads as broken. */}
            {isLast && !turn.answer && (phase === "thinking" || phase === "tools") && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-zinc-500">
                <Database className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} />
                {phase === "tools"
                  ? "Looking things up in your journal…"
                  : names.length > 0
                    ? "Reading the results…"
                    : "Thinking…"}
              </p>
            )}

            {/* A turn that never reached an answer (Stop mid-lookup, a closed
                tab, a cut request): the server can carry on from where it
                stopped, so offer that rather than a dead end. */}
            {isLast && needsContinue && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">This answer was stopped before it finished.</p>
                <button
                  type="button"
                  onClick={onResume}
                  className="rounded-full border border-zinc-300 px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Resume
                </button>
              </div>
            )}

            {(turn.answer || turn.activity.length > 0) && (
              <Card hoverable={false} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    {turn.answer?.status === "streaming" ? `${providerLabel} is answering` : `${providerLabel} answered`}
                  </p>
                  {/* When the model reached for the data tools, name what it
                      touched so the number has a visible provenance. */}
                  {names.length > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <Database className="h-3 w-3" strokeWidth={2} />
                      {describeActivity(names)}
                    </span>
                  )}
                </div>

                {turn.answer && (
                  // AnswerText builds React elements from the string -- it never
                  // touches dangerouslySetInnerHTML, so provider output
                  // (untrusted text, round-tripped through a third party)
                  // still cannot inject markup here.
                  <AnswerText text={turn.answer.content} />
                )}

                {turn.answer?.status === "interrupted" && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-500">
                    <PauseCircle className="h-3.5 w-3.5" strokeWidth={2} />
                    Stopped before it finished — this isn&apos;t the complete answer.
                  </p>
                )}

                {isLast && phase === "awaiting_keep_going" && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-3 dark:border-subtle">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      It has made {turn.activity.length} lookup{turn.activity.length === 1 ? "" : "s"} and wants
                      to keep going.
                    </p>
                    <button
                      type="button"
                      onClick={onKeepGoing}
                      className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white dark:text-zinc-950 hover:brightness-110"
                    >
                      Keep going
                    </button>
                  </div>
                )}
              </Card>
            )}
          </div>
        );
      })}
    </div>
  );
}
