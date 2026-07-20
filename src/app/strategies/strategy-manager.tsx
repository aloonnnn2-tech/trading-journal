"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Strategy } from "@/lib/strategies/types";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

export function StrategyManager({ initialStrategies }: { initialStrategies: Strategy[] }) {
  const router = useRouter();
  const [strategies, setStrategies] = useState(initialStrategies);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("#2563eb");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);

    const res = await fetch("/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description.trim() || null, color }),
    });
    setLoading(false);

    if (res.ok) {
      const created = (await res.json()) as Strategy;
      setStrategies((prev) => [...prev, created]);
      setName("");
      setDescription("");
      router.refresh();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this strategy? Trades stay, just unassigned from it. Its custom fields are removed.")) return;
    const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setStrategies((prev) => prev.filter((s) => s.id !== id));
    router.refresh();
  }

  function startEdit(strategy: Strategy) {
    setEditingId(strategy.id);
    setEditName(strategy.name);
    setEditDescription(strategy.description ?? "");
    setEditColor(strategy.color ?? "#2563eb");
  }

  async function handleSaveEdit(id: string) {
    const res = await fetch(`/api/strategies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDescription.trim() || null, color: editColor }),
    });

    if (res.ok) {
      const updated = (await res.json()) as Strategy;
      setStrategies((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {strategies.map((strategy) => (
          <li
            key={strategy.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card px-4 py-2"
          >
            {editingId === strategy.id ? (
              <div className="flex flex-col gap-2">
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className={inputClass}
                />
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="h-8 w-14 rounded border border-zinc-300 dark:border-zinc-700"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(strategy.id)}
                    className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white dark:text-zinc-950 hover:brightness-110"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: strategy.color ?? "#a1a1aa" }}
                  />
                  <div>
                    <span className="text-zinc-900 dark:text-zinc-100">{strategy.name}</span>
                    {strategy.description && (
                      <span className="ml-2 text-xs text-zinc-500">{strategy.description}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => startEdit(strategy)} className="text-xs text-zinc-500 hover:text-zinc-300">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(strategy.id)} className="text-xs text-red-400 hover:text-red-300">
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {strategies.length === 0 && <p className="text-sm text-zinc-500">No strategies yet.</p>}
      </ul>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4"
      >
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Add a strategy</h3>
        <input
          type="text"
          placeholder="Strategy name, e.g. Breakout"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-14 rounded border border-zinc-300 dark:border-zinc-700"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Adding..." : "+ Add Strategy"}
        </button>
      </form>
    </div>
  );
}
