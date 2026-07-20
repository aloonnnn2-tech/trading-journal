export const ENTITY_TYPES = ["trade", "investment"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "currency",
  "percentage",
  "dropdown",
  "multi_select",
  "checkbox",
  "rating",
  "large_notes",
  "tag",
  "color_picker",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldOptions {
  choices?: string[];
  min?: number;
  max?: number;
}

export interface FieldDefinition {
  id: string;
  user_id: string;
  entity_type: EntityType;
  key: string;
  label: string;
  field_type: FieldType;
  options: FieldOptions;
  sort_order: number;
  is_default: boolean;
  // Null for a field global to the entity type (today's behavior). Set to
  // a strategy's id to scope the field to trades using that strategy --
  // e.g. a "Volume confirmation" field that only makes sense for a
  // "Breakout" strategy.
  strategy_id: string | null;
  created_at: string;
}

export type NewFieldDefinition = Pick<
  FieldDefinition,
  "entity_type" | "key" | "label" | "field_type"
> &
  Partial<Pick<FieldDefinition, "options" | "sort_order" | "strategy_id">>;
