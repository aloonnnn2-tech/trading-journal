import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  // Both entity types: a CSV/XLSX import can produce investment-mode rows
  // (via a mapped "Mode" column) as well as standard trades, so its custom
  // fields need to be selectable in the mapping step too -- mirrors
  // api/trades/export/route.ts's existing "fetch both" pattern.
  const [tradeFieldDefinitions, investmentFieldDefinitions] = await Promise.all([
    listFieldDefinitions(supabase, "trade"),
    listFieldDefinitions(supabase, "investment"),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Import Trades
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload a CSV or Excel file from your broker, or re-import a journal you
          previously exported as JSON.
        </p>
      </div>
      <ImportWizard
        tradeFieldDefinitions={tradeFieldDefinitions}
        investmentFieldDefinitions={investmentFieldDefinitions}
      />
    </div>
  );
}
