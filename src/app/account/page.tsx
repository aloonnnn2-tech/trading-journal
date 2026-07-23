import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { DeleteAccountSection } from "./delete-account-section";

export default async function AccountPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Account
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">{data.user.email}</p>
      </div>

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
