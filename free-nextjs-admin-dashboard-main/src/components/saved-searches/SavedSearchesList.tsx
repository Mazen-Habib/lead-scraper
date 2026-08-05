"use client";
import React, { useState } from "react";
import Link from "next/link";
import RunControls from "./RunControls";

export type SavedSearch = {
  id: number;
  name: string;
  filter_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

function filterJsonToParams(filterJson: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(filterJson).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  return params.toString();
}

function filterSummary(filterJson: Record<string, unknown>): string {
  const parts = Object.entries(filterJson)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join(" · ") : "No filters (all leads)";
}

export default function SavedSearchesList({ initialSavedSearches }: { initialSavedSearches: SavedSearch[] }) {
  const [items, setItems] = useState(initialSavedSearches);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (item: SavedSearch) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
  };

  const submitRename = async (id: number) => {
    if (!renameValue.trim()) return;
    const res = await fetch(`/api/saved-searches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (res.ok) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name: renameValue.trim() } : i)));
    }
    setRenamingId(null);
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-10 text-center">
        <div className="text-3xl mb-2">🔖</div>
        <p className="text-gray-500 dark:text-gray-400">
          No saved searches yet. Apply filters on the{" "}
          <Link href="/leads" className="text-brand-500 hover:underline">
            Leads page
          </Link>{" "}
          and save one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            {renamingId === item.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitRename(item.id)}
                onBlur={() => submitRename(item.id)}
                className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            ) : (
              <p className="font-semibold text-gray-800 dark:text-white truncate">{item.name}</p>
            )}
            <p className="text-xs text-gray-400 truncate mt-0.5">{filterSummary(item.filter_json)}</p>
            <div className="mt-2.5">
              <RunControls savedSearchId={item.id} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/my-leads?savedSearchId=${item.id}`}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              My Leads
            </Link>
            <Link
              href={`/leads?${filterJsonToParams(item.filter_json)}`}
              className="rounded-lg bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              Apply
            </Link>
            <button
              onClick={() => startRename(item)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => remove(item.id)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
