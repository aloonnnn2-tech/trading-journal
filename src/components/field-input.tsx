"use client";

import type { FieldDefinition } from "@/lib/fields/types";

type FieldValue = string | number | boolean | string[] | null | undefined;

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

export function FieldInput({
  field,
  value,
  onChange,
  id,
}: {
  field: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  /**
   * Ties this control to the <label> its caller renders above it. Optional so
   * existing call sites keep compiling, but every one of them should pass it:
   * a custom field with no associated label reaches a screen reader as an
   * unnamed edit box, which on a form of user-defined fields means the whole
   * form is unnavigable.
   */
  id?: string;
}) {
  switch (field.field_type) {
    case "large_notes":
      return (
        <textarea
          id={id}
          className={`${inputClass} min-h-28 resize-y`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "text":
      return (
        <input
          id={id}
          type="text"
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "color_picker":
      return (
        <input
          id={id}
          type="color"
          className="h-10 w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          value={(value as string) ?? "#10b981"}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "date":
      return (
        <input
          id={id}
          type="date"
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
    case "currency":
    case "percentage":
      return (
        <input
          id={id}
          type="number"
          step="any"
          className={inputClass}
          value={value === null || value === undefined ? "" : (value as number)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );

    case "rating": {
      const min = field.options.min ?? 1;
      const max = field.options.max ?? 10;
      return (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          className={inputClass}
          value={value === null || value === undefined ? "" : (value as number)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    }

    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          className="h-5 w-5 rounded border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    case "dropdown": {
      const choices = field.options.choices ?? [];
      return (
        <select
          id={id}
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      );
    }

    case "multi_select":
    case "tag": {
      const arrayValue = Array.isArray(value) ? value : [];
      return (
        <input
          id={id}
          type="text"
          placeholder="Comma-separated"
          className={inputClass}
          value={arrayValue.join(", ")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            )
          }
        />
      );
    }

    default:
      return null;
  }
}
