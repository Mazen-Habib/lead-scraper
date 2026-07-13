"use client";
import React, { useState, useMemo } from "react";
import type { Lead } from "@/lib/lead-types";
import { SOURCE_LABELS } from "@/lib/lead-types";

const TIER_COLORS = {
  A: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  D: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const PAGE_SIZE = 50;

function exportCSV(leads: Lead[], filename = "leads-export.csv") {
  const cols = [
    "company_name","category","email","phone","address","website",
    "linkedin","source","score","tier","rating","review_count",
    "company_size","hourly_rate","email_verified","scraped_at",
  ] as (keyof Lead)[];

  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = cols.join(",");
  const rows = leads.map((l) => cols.map((c) => escape(l[c] ?? "")).join(","));
  const blob = new Blob([[header, ...rows].join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LeadsTable({ leads }: { leads: Lead[] }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [emailOnly, setEmailOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<"score" | "scraped_at">("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const allSources = useMemo(() => {
    const s = new Set(leads.map((l) => l.source).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads
      .filter((l) => {
        if (tierFilter !== "All" && l.tier !== tierFilter) return false;
        if (sourceFilter !== "All" && l.source !== sourceFilter) return false;
        if (emailOnly && !l.email) return false;
        if (q && !l.company_name?.toLowerCase().includes(q) &&
            !l.email?.toLowerCase().includes(q) &&
            !l.address?.toLowerCase().includes(q) &&
            !l.category?.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortCol === "score") {
          const diff = (parseInt(b.score) || 0) - (parseInt(a.score) || 0);
          return sortDir === "desc" ? diff : -diff;
        }
        const diff = (b.scraped_at ?? "").localeCompare(a.scraped_at ?? "");
        return sortDir === "desc" ? diff : -diff;
      });
  }, [leads, search, tierFilter, sourceFilter, emailOnly, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageLeads = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (col: "score" | "scraped_at") => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  };

  const resetPage = () => setPage(1);

  const SortIcon = ({ col }: { col: "score" | "scraped_at" }) =>
    sortCol === col ? (sortDir === "desc" ? " ↓" : " ↑") : " ↕";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search company, email, location…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="flex-1 min-w-[200px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />

          <select
            value={tierFilter}
            onChange={(e) => { setTierFilter(e.target.value); resetPage(); }}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            {["All", "A", "B", "C", "D"].map((t) => (
              <option key={t} value={t}>{t === "All" ? "All Tiers" : `Tier ${t}`}</option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); resetPage(); }}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            {allSources.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All Sources" : (SOURCE_LABELS[s] ?? s)}</option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={emailOnly}
              onChange={(e) => { setEmailOnly(e.target.checked); resetPage(); }}
              className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            Email only
          </label>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {filtered.length.toLocaleString()} leads
            </span>
            <button
              onClick={() => exportCSV(filtered)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Contact</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Location</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
                <th
                  className="px-5 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => toggleSort("score")}
                >
                  Score<SortIcon col="score" />
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Tier</th>
                <th
                  className="px-5 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => toggleSort("scraped_at")}
                >
                  Scraped<SortIcon col="scraped_at" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    No leads match your filters.
                  </td>
                </tr>
              ) : (
                pageLeads.map((lead, i) => {
                  const tier = lead.tier as keyof typeof TIER_COLORS;
                  const scrapeDate = lead.scraped_at
                    ? new Date(lead.scraped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "—";
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 max-w-[200px]">
                        <div className="font-medium text-gray-800 dark:text-white truncate">
                          {lead.website ? (
                            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">
                              {lead.company_name || "—"}
                            </a>
                          ) : (lead.company_name || "—")}
                        </div>
                        {lead.category && (
                          <div className="text-xs text-gray-400 truncate">{lead.category}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 max-w-[200px]">
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`} className="block text-gray-600 dark:text-gray-300 hover:text-brand-500 truncate">
                            {lead.email}
                          </a>
                        ) : <span className="text-gray-400">—</span>}
                        {lead.phone && (
                          <div className="text-xs text-gray-400 truncate">{lead.phone}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[140px] truncate">
                        {lead.address || "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {SOURCE_LABELS[lead.source] ?? (lead.source || "—")}
                      </td>
                      <td className="px-5 py-3 font-semibold text-gray-800 dark:text-white">
                        {lead.score || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {tier ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[tier] ?? TIER_COLORS.D}`}>
                            {tier}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                        {scrapeDate}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-800">
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages} ({filtered.length.toLocaleString()} leads)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
