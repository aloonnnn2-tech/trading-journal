import Link from "next/link";
import { Sparkles, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/supabase/auth";
import { getUserSettings } from "@/lib/settings/queries";
import { isPaidUser } from "@/lib/settings/plan";
import { listApiKeys } from "@/lib/ai-keys/queries";
import { FREE_TIER_PROVIDERS, PROVIDER_LABELS, SELECTABLE_PROVIDERS } from "@/lib/ai-keys/types";
import { listConsentedProviders } from "@/lib/ai-keys/consent";
import { Card } from "@/components/ui/Card";
import { getConversation, listConversations, listMessages, type Conversation } from "@/lib/chat/queries";
import { foldMessages, type TurnView } from "@/lib/chat/fold";
import { ChatShell } from "./chat-shell";

// Derived from the provider registry rather than written out, because the
// hand-written version of this list went stale: it still said "OpenAI,
// Anthropic or Google" long after seven free-tier providers were added, hiding
// the most useful fact on the paywall -- that this costs nothing to try.
const FREE_TIER_NAMES = SELECTABLE_PROVIDERS.filter((p) => FREE_TIER_PROVIDERS.has(p)).map(
  (p) => PROVIDER_LABELS[p],
);

// Derived from SELECTABLE_PROVIDERS, not from "everything minus free": a
// retired provider is in neither list, and filtering the full set would have
// quietly promoted it into the paid column the moment it left the free one.
const PAID_ONLY_NAMES = SELECTABLE_PROVIDERS.filter((p) => !FREE_TIER_PROVIDERS.has(p)).map(
  (p) => PROVIDER_LABELS[p],
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { c: requestedId } = await searchParams;

  const settings = await getUserSettings(supabase, userId);
  const paid = isPaidUser(settings);

  // Keys, consents and conversations are only fetched for a paid user. A free
  // user's request never touches those tables, so the paywall can't leak
  // whether they once had a key. Consent is read under the CHAT scope (0047):
  // agreement to the older per-question disclosure does not carry over.
  const [keys, consents, conversations] = paid
    ? await Promise.all([
        listApiKeys(supabase),
        listConsentedProviders(supabase, "chat_v2"),
        listConversations(supabase),
      ])
    : [[], [], []];

  // Server-render the requested conversation so a refresh lands on the same
  // transcript with no flash. RLS makes another user's id simply not resolve.
  let conversation: Conversation | null = null;
  let turns: TurnView[] = [];
  // A non-UUID id used to reach Postgres and 500 the whole page render.
  if (paid && requestedId && UUID.test(requestedId)) {
    conversation = await getConversation(supabase, requestedId);
    if (conversation) turns = foldMessages(await listMessages(supabase, requestedId, userId));
  }

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
        <ChatShell
          initialKeys={keys}
          initialConsents={consents}
          initialConversations={conversations}
          initialConversation={conversation}
          initialTurns={turns}
        />
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
              Bring your own API key — {FREE_TIER_NAMES.length} providers have a free tier
              ({FREE_TIER_NAMES.join(", ")}), and {PAID_ONLY_NAMES.join(" and ")} work too
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
