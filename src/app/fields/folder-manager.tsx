"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Folder } from "@/lib/folders/types";

const inputClass =
  "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary";

export function FolderManager({ initialFolders }: { initialFolders: Folder[] }) {
  const router = useRouter();
  const [folders, setFolders] = useState(initialFolders);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);

    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setLoading(false);

    if (res.ok) {
      const created = (await res.json()) as Folder;
      setFolders((prev) => [...prev, created]);
      setName("");
      router.refresh();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this folder? Trades stay, just unassigned from it.")) return;
    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {folders.map((folder) => (
          <li
            key={folder.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card px-4 py-2"
          >
            <span className="text-zinc-900 dark:text-zinc-100">{folder.name}</span>
            <button
              onClick={() => handleDelete(folder.id)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </li>
        ))}
        {folders.length === 0 && <p className="text-sm text-zinc-500">No folders yet.</p>}
      </ul>

      <form
        onSubmit={handleAdd}
        className="flex gap-2 rounded-lg border border-zinc-200 dark:border-subtle bg-white dark:bg-card p-4"
      >
        <input
          type="text"
          placeholder="Folder name, e.g. Swing Trades"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Adding..." : "+ Add"}
        </button>
      </form>
    </div>
  );
}