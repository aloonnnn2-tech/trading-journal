import type { SupabaseClient } from "@supabase/supabase-js";
import type { Folder } from "./types";

export async function listFolders(supabase: SupabaseClient): Promise<Folder[]> {
  const { data, error } = await supabase.from("folders").select("*").order("name");
  if (error) throw error;
  return data as Folder[];
}

export async function createFolder(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<Folder> {
  const { data, error } = await supabase
    .from("folders")
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw error;
  return data as Folder;
}

export async function deleteFolder(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) throw error;
}

export async function listTradeFolderIds(
  supabase: SupabaseClient,
  tradeId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("trade_folders")
    .select("folder_id")
    .eq("trade_id", tradeId);
  if (error) throw error;
  return data.map((row) => row.folder_id as string);
}

// Replaces the full set of folders a trade belongs to in one call.
export async function setTradeFolders(
  supabase: SupabaseClient,
  tradeId: string,
  folderIds: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("trade_folders")
    .delete()
    .eq("trade_id", tradeId);
  if (deleteError) throw deleteError;

  if (folderIds.length === 0) return;

  const { error: insertError } = await supabase
    .from("trade_folders")
    .insert(folderIds.map((folderId) => ({ trade_id: tradeId, folder_id: folderId })));
  if (insertError) throw insertError;
}

// Maps trade_id -> folder_id[] for every trade owned by the current user,
// used by the Trades list page to filter/display folder membership in
// one query rather than one round-trip per trade.
export async function listAllTradeFolderLinks(
  supabase: SupabaseClient,
): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("trade_folders").select("trade_id, folder_id");
  if (error) throw error;

  const map: Record<string, string[]> = {};
  for (const row of data) {
    const tradeId = row.trade_id as string;
    (map[tradeId] ??= []).push(row.folder_id as string);
  }
  return map;
}
