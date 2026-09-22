"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";
import type { Conversation } from "@/lib/chat/queries";
import { PROVIDER_LABELS } from "@/lib/ai-keys/types";

// The saved conversations. A left rail on desktop, a select on phones --
// the same data either way, so nothing here is layout-specific beyond the
// class names.
export function ConversationList({
  items,
  activeId,
  busy,
  onSelect,
  onNew,
  onDelete,
}: {
  items: Conversation[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      {/* Phone: a compact select plus a New button. */}
      <div className="flex items-center gap-2 md:hidden">
        <select
          value={activeId ?? ""}
          onChange={(e) => e.target.value && onSelect(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-primary"
        >
          {!activeId && <option value="">New conversation</option>}
          {items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "Untitled"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          title="New conversation"
          className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop: the rail. */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 md:flex">
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New conversation
        </button>
        {items.length === 0 && <p className="px-2.5 text-xs text-zinc-500">Your conversations will appear here.</p>}
        {items.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-lg ${
              c.id === activeId ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
            }`}
          >
            {/* data-track-private: a title is the user's own first message. */}
            <button
              type="button"
              data-track="conversation-open"
              data-track-private
              onClick={() => onSelect(c.id)}
              disabled={busy}
              className="min-w-0 flex-1 px-2.5 py-2 text-left disabled:opacity-50"
            >
              <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">{c.title ?? "Untitled"}</span>
              <span className="block text-[11px] text-zinc-500">{PROVIDER_LABELS[c.provider] ?? c.provider}</span>
            </button>
            <button
              type="button"
              data-track="conversation-delete"
              onClick={() => onDelete(c.id)}
              disabled={busy}
              title="Delete conversation"
              className="mr-1 rounded p-1 text-zinc-400 opacity-0 hover:text-red-400 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </aside>
    </>
  );
}
