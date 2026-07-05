export type EntityType = "trade" | "investment";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "currency"
  | "percentage"
  | "dropdown"
  | "multi_select"
  | "checkbox"
  | "rating"
  | "large_notes"
  | "tag"
  | "color_picker";

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
  created_at: string;
}

export type NewFieldDefinition = Pick<
  FieldDefinition,
  "entity_type" | "key" | "label" | "field_type"
> &
  Partial<Pick<FieldDefinition, "options" | "sort_order">>;
