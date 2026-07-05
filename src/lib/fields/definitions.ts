import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntityType, FieldDefinition, NewFieldDefinition } from "./types";

// Field-definition CRUD. Every caller (Trade Card rendering, the template
// editor, CSV import column-mapping, search/filter UI) goes through this
// module rather than querying field_definitions directly, so the
// additive-only schema-evolution rule lives in one place.

export async function listFieldDefinitions(
  supabase: SupabaseClient,
  entityType: EntityType,
): Promise<FieldDefinition[]> {
  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity_type", entityType)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data as FieldDefinition[];
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
export async function deleteFieldDefinition(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("field_definitions").delete().eq("id", id);
  if (error) throw error;
}
