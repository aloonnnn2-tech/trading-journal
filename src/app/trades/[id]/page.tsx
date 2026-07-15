import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFieldDefinitions } from "@/lib/fields/definitions";
import { listFolders, listTradeFolderIds } from "@/lib/folders/queries";
import { getUserSettings } from "@/lib/settings/queries";
import { getTrade } from "@/lib/trades/queries";
import { listTradeImages } from "@/lib/images/queries";
import { TradeCard } from "@/components/trade-card/TradeCard";
import { TradeHistoryPanel } from "@/components/trade-card/trade-history-panel";

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  const trade = await getTrade(supabase, id);
  if (!trade) notFound();

  const [fieldDefinitions, settings, folders, initialFolderIds, rawImages] = await Promise.all([
    listFieldDefinitions(supabase, trade.mode),
    getUserSettings(supabase, userData.user.id),
    listFolders(supabase),
    listTradeFolderIds(supabase, id),
    listTradeImages(supabase, id),
  ]);

  // Generate signed URLs for all images in one batched Storage call (1-hour
  // expiry, server-side only) rather than one round trip per image -- with
  // several screenshots on a trade, N sequential API calls was a real chunk
  // of this page's load time.
  const signedUrls =
    rawImages.length > 0
      ? await supabase.storage
          .from("trade-images")
          .createSignedUrls(rawImages.map((img) => img.storage_path), 3600)
      : { data: [] };
  const urlByPath = new Map(signedUrls.data?.map((r) => [r.path, r.signedUrl]) ?? []);
  const initialImages = rawImages.map((img) => ({
    id: img.id,
    storagePath: img.storage_path,
    signedUrl: urlByPath.get(img.storage_path) ?? "",
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <Link href="/trades" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to Trades
      </Link>
      <TradeCard
        trade={trade}
        fieldDefinitions={fieldDefinitions}
        hiddenCoreFields={settings.hidden_core_fields}
        folders={folders}
        initialFolderIds={initialFolderIds}
        initialImages={initialImages}
      />
      <TradeHistoryPanel tradeId={id} />
    </div>
  );
}
