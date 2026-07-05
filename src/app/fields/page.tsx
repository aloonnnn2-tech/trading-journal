import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { listFolders } from "@/lib/folders/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { FieldManager } from "./field-manager";
import { CoreFieldToggles } from "./core-field-toggles";
import { FolderManager } from "./folder-manager";

export default async function FieldsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  const tradeFields = await listFieldDefinitions(supabase, "trade");
  const settings = await getUserSettings(supabase, userData.user.id);
  const folders = await listFolders(supabase);

  return (
    <div className="flex flex-1 flex-col gap-10 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Built-in Fields
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Show or hide the built-in trade fields (like Stop Loss) on the trade form.
          Hidden fields keep any data already saved in them.
        </p>
        <div className="mt-4 max-w-lg">
          <CoreFieldToggles initialHidden={settings.hidden_core_fields} />
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Custom Fields
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Add, rename, retype, reorder, or remove your own custom fields. Removing one
          only hides it going forward — data already saved under it is kept.
        </p>
        <div className="mt-4 max-w-lg">
          <FieldManager entityType="trade" initialFields={tradeFields} />
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Folders</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Custom folders (Swing Trades, Crypto, Options, etc.) you can assign trades to.
        </p>
        <div className="mt-4 max-w-lg">
          <FolderManager initialFolders={folders} />
        </div>
      </div>
    </div>
  );
}
