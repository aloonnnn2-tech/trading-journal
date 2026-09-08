import Link from "next/link";
import { Sparkles, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { listApiKeys } from "@/lib/ai-keys/queries";
import { listConsentedProviders } from "@/lib/ai-keys/consent";
import { Card } from "@/components/ui/Card";
import { AskManager } from "./ask-manager";

export default async function AskPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const settings = await getUserSettings(supabase, userId);
  const paid = isPaidUser(settings);

  // Keys and consents are only fetched for a paid user. A free user's request
  // never touches either table, so the paywall can't leak whether they once
  // had a key.
  const [keys, consents] = paid
    ? await Promise.all([listApiKeys(supabase), listConsentedProviders(supabase)])
    : [[], []];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6 sm:p-8">
      <div data-tour-id="ask-header">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Ask Your Journal
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Ask questions about your own trading in plain English, answered by the AI provider you
          connect.
        </p>
      </div>

      {paid ? (
        <AskManager initialKeys={keys} initialConsents={consents} />
      ) : (
        <Card hoverable={false} className="flex flex-col gap-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lock className="h-4 w-4" strokeWidth={2} />
          </span>

          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              This is a paid-plan feature
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Ask free-text questions about your trades and get answers grounded in your own
              journal. Your performance by day, setup, emotion and risk size, plus your recent
              trades and notes.
            </p>
          </div>

          <ul className="flex flex-col gap-1.5 text-sm text-zinc-500">
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
              Bring your own API key from OpenAI, Anthropic or Google
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
              Runs on your provider account, so this app never marks up AI usage
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
              Your key is encrypted at rest and only used for your own questions
            </li>
          </ul>

          <Link
            href="/#pricing"
            className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110"
          >
            See plans
          </Link>
        </Card>
      )}
    </div>
  );
}
