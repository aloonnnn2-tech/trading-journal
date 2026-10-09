import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { DeleteAccountSection } from "./delete-account-section";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-5 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Account
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">{data.user.email}</p>
      </div>

      <Card hoverable={false}>
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Your data
        </h2>
        <p className="mb-4 text-sm text-zinc-500">
          Download everything Trading Lens stores about your account as one file: trades and their
          edit history, strategies, notes, settings, AI reviews and conversations, a list of your
          screenshots, and the usage events recorded for your account.
        </p>
        {/* A plain download link: the route answers with an attachment. */}
        <a
          href="/api/account/export"
          download
          className="inline-flex rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-white/5"
        >
          Download all my data
        </a>
      </Card>

      <Card hoverable={false} className="border-loss/30">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-loss">
          Danger zone
        </h2>
        <p className="mb-4 text-sm text-zinc-500">
          Permanently delete your account and all trades, images, and settings. This can&apos;t be
          undone.
        </p>
        <DeleteAccountSection email={data.user.email ?? ""} />
      </Card>
    </div>
  );
}
