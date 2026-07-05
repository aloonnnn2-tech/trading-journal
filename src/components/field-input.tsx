"use client";

import type { FieldDefinition } from "@/lib/fields/types";

type FieldValue = string | number | boolean | string[] | null | undefined;

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  switch (field.field_type) {
    case "large_notes":
      return (
        <textarea
          className={`${inputClass} min-h-28 resize-y`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "text":
      return (
        <input
          type="text"
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "color_picker":
      return (
        <input
          type="color"
          className="h-10 w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          value={(value as string) ?? "#10b981"}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "date":
      return (
        <input
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
