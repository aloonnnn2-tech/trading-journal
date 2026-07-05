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

// Returns whether a row was actually deleted, so the route can 404 rather
// than report success for an id that didn't exist (or belonged to another
// user and was silently filtered out by RLS).
export async function deleteFolder(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("folders").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
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
  // Dedupe first -- otherwise a duplicate id in the payload makes the
  // count check below reject a request that's actually valid (`.in()`
  // naturally collapses duplicates, so the counts would never match).
  folderIds = Array.from(new Set(folderIds));

  if (folderIds.length > 0) {
    // Validate before deleting anything -- a folderId that doesn't exist
    // (or belongs to another user, filtered out by RLS) would otherwise
    // fail the insert *after* the existing links are already gone,
    // leaving the trade with none.
    const { data: validFolders, error: validateError } = await supabase
      .from("folders")
      .select("id")
      .in("id", folderIds);
    if (validateError) throw validateError;
    if ((validFolders?.length ?? 0) !== folderIds.length) {
      throw new Error("One or more folders were not found");
    }
  }

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
