"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EntityType, FieldDefinition, FieldType } from "@/lib/fields/types";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "currency", label: "Currency" },
  { value: "percentage", label: "Percentage" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multi_select", label: "Multi Select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "rating", label: "Rating (1-10)" },
  { value: "large_notes", label: "Large Notes" },
  { value: "tag", label: "Tag" },
  { value: "color_picker", label: "Color Picker" },
];

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

function choicesToString(field: FieldDefinition) {
  return (field.options.choices ?? []).join(", ");
}

export function FieldManager({
  entityType,
  initialFields,
}: {
  entityType: EntityType;
  initialFields: FieldDefinition[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState(
    [...initialFields].sort((a, b) => a.sort_order - b.sort_order),
  );
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [choices, setChoices] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editFieldType, setEditFieldType] = useState<FieldType>("text");
  const [editChoices, setEditChoices] = useState("");

  const needsChoices = fieldType === "dropdown" || fieldType === "multi_select";
  const editNeedsChoices = editFieldType === "dropdown" || editFieldType === "multi_select";

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);

    const options = needsChoices
      ? { choices: choices.split(",").map((c) => c.trim()).filter(Boolean) }
      : {};

    const res = await fetch("/api/field-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_type: entityType,
        label,
        field_type: fieldType,
        options,
        sort_order: (fields[fields.length - 1]?.sort_order ?? 0) + 1,
      }),
    });
    setLoading(false);

    if (res.ok) {
      const created = (await res.json()) as FieldDefinition;
      setFields((prev) => [...prev, created]);
      setLabel("");
      setChoices("");
      router.refresh();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this field? Existing trade data for it is kept but hidden.")) return;
    const res = await fetch(`/api/field-definitions/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setFields((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  function startEdit(field: FieldDefinition) {
    setEditingId(field.id);
    setEditLabel(field.label);
    setEditFieldType(field.field_type);
    setEditChoices(choicesToString(field));
  }

  async function handleSaveEdit(id: string) {
    const options = editNeedsChoices
      ? { choices: editChoices.split(",").map((c) => c.trim()).filter(Boolean) }
      : {};

    const res = await fetch(`/api/field-definitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editLabel, field_type: editFieldType, options }),
    });

    if (res.ok) {
      const updated = (await res.json()) as FieldDefinition;
      setFields((prev) => prev.map((f) => (f.id === id ? updated : f)));
      setEditingId(null);
      router.refresh();
    }
  }

  async function moveField(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const current = fields[index];
    const target = fields[targetIndex];

    const reordered = [...fields];
    reordered[index] = target;
    reordered[targetIndex] = current;
    setFields(reordered);

    const [resA, resB] = await Promise.all([
      fetch(`/api/field-definitions/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: target.sort_order }),
      }),
      fetch(`/api/field-definitions/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: current.sort_order }),
      }),
    ]);

    if (!resA.ok || !resB.ok) {
      // Revert the optimistic swap so the UI doesn't show an order the
      // server doesn't have. Note: if only one of the two PATCHes above
      // actually failed, the DB can still be left with mismatched
      // sort_order values between these two fields -- reverting the UI
      // doesn't undo that half-applied write.
      setFields((prev) => {
        const reverted = [...prev];
        reverted[index] = current;
        reverted[targetIndex] = target;
        return reverted;
      });
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {fields.map((field, index) => (
          <li
            key={field.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card px-4 py-2"
          >
            {editingId === field.id ? (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className={inputClass}
                />
                <select
                  value={editFieldType}
                  onChange={(e) => setEditFieldType(e.target.value as FieldType)}
                  className={inputClass}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                {editNeedsChoices && (
                  <input
                    type="text"
                    placeholder="Choices, comma-separated"
                    value={editChoices}
                    onChange={(e) => setEditChoices(e.target.value)}
                    className={inputClass}
                  />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(field.id)}
                    className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white dark:text-zinc-950 hover:brightness-110"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-zinc-900 dark:text-zinc-100">{field.label}</span>
                  <span className="ml-2 text-xs text-zinc-500">{field.field_type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => moveField(index, -1)}
                    disabled={index === 0}
                    className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
                  >
                    â†‘
                  </button>
                  <button
                    onClick={() => moveField(index, 1)}
                    disabled={index === fields.length - 1}
                    className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
                  >
                    â†“
                  </button>
                  <button
                    onClick={() => startEdit(field)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(field.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {fields.length === 0 && <p className="text-sm text-zinc-500">No fields yet.</p>}
      </ul>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4"
      >
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Add a field
        </h3>
        <input
          type="text"
          placeholder="Field name, e.g. Risk at Entry"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
        />
        <select
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldType)}
          className={inputClass}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        {needsChoices && (
          <input
            type="text"
            placeholder="Choices, comma-separated"
            value={choices}
            onChange={(e) => setChoices(e.target.value)}
            className={inputClass}
          />
        )}
        <button
          type="submit"
          disabled={loading || !label.trim()}
          className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Adding..." : "+ Add Field"}
        </button>
      </form>
    </div>
  );
}