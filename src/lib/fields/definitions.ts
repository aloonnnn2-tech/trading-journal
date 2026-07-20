import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntityType, FieldDefinition, NewFieldDefinition } from "./types";

// Field-definition CRUD. Every caller (Trade Card rendering, the template
// editor, CSV import column-mapping, search/filter UI) goes through this
// module rather than querying field_definitions directly, so the
// additive-only schema-evolution rule lives in one place.

// strategyId omitted -> global fields (strategy_id is null), the original
// behavior every existing caller still gets. Pass a strategy's id to get
// only that strategy's own scoped fields instead.
export async function listFieldDefinitions(
  supabase: SupabaseClient,
  entityType: EntityType,
  strategyId?: string,
): Promise<FieldDefinition[]> {
  let query = supabase.from("field_definitions").select("*").eq("entity_type", entityType);
  query = strategyId ? query.eq("strategy_id", strategyId) : query.is("strategy_id", null);

  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) throw error;
  return data as FieldDefinition[];
}

// All strategy-scoped field definitions for a set of strategies in one
// query, grouped by strategy id -- used by the Trade Card, which needs to
// know every selectable strategy's fields up front rather than issuing
// one query per strategy as the user toggles selections.
export async function listFieldDefinitionsForStrategies(
  supabase: SupabaseClient,
  entityType: EntityType,
  strategyIds: string[],
): Promise<Record<string, FieldDefinition[]>> {
  if (strategyIds.length === 0) return {};

  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", entityType)
    .in("strategy_id", strategyIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const map: Record<string, FieldDefinition[]> = {};
  for (const field of data as FieldDefinition[]) {
    (map[field.strategy_id as string] ??= []).push(field);
  }
  return map;
}

// Every strategy-scoped field definition the user has, for the given
// entity type, grouped by strategy id. Unlike listFieldDefinitionsForStrategies,
// this doesn't need to know which strategies exist first (RLS already
// scopes it to the current user) -- so callers can fetch it in parallel
// with the strategy list itself instead of waiting on it.
export async function listAllStrategyFieldDefinitions(
  supabase: SupabaseClient,
  entityType: EntityType,
): Promise<Record<string, FieldDefinition[]>> {
  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", entityType)
    .not("strategy_id", "is", null)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const map: Record<string, FieldDefinition[]> = {};
  for (const field of data as FieldDefinition[]) {
    (map[field.strategy_id as string] ??= []).push(field);
  }
  return map;
}

export async function createFieldDefinition(
  supabase: SupabaseClient,
  userId: string,
  field: NewFieldDefinition,
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from("field_definitions")
    .insert({
      user_id: userId,
      entity_type: field.entity_type,
      key: field.key,
      label: field.label,
      field_type: field.field_type,
      options: field.options ?? {},
      sort_order: field.sort_order ?? 0,
      strategy_id: field.strategy_id ?? null,
      is_default: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FieldDefinition;
}

// Renaming a field or changing its label/options/order is safe because it
// never touches trades.custom_fields values. Changing field_type is also
// allowed here -- it is the UI's job (Milestone 2) to show a "type
// changed" indicator for values that no longer match the new type rather
// than attempting lossy conversion.
export async function updateFieldDefinition(
  supabase: SupabaseClient,
  id: string,
  changes: Partial<Pick<FieldDefinition, "label" | "field_type" | "options" | "sort_order">>,
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from("field_definitions")
    .update(changes)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as FieldDefinition;
}

// Deletes the field definition only. Existing trades keep the value
// under their custom_fields key forever -- it just stops being rendered
// on the active template.
// Returns whether a row was actually deleted, so the route can 404 rather
// than report success for an id that didn't exist (or belonged to another
// user and was silently filtered out by RLS).
export async function deleteFieldDefinition(
  supabase: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await supabase.from("field_definitions").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
