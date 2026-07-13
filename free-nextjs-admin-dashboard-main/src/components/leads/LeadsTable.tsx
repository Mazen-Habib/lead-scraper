"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Lead } from "@/lib/lead-types";
import { SOURCE_LABELS } from "@/lib/lead-types";

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  D: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const TIER_BAR: Record<string, string> = {
  A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-400", D: "bg-gray-400",
};

const PAGE_SIZE = 50;

function exportCSV(leads: Lead[]) {
  const cols = [
    "company_name","category","email","phone","address","website",
    "linkedin","source","score","tier","rating","review_count",
    "company_size","hourly_rate","email_verified","scraped_at",
  ] as (keyof Lead)[];
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const blob = new Blob(
    [[cols.join(","), ...leads.map((l) => cols.map((c) => esc(l[c] ?? "")).join(","))].join("\r\n")],
    { type: "text/csv" }
  );
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "leads.csv" });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Lead detail drawer ────────────────────────────────────────────────────────

function Field({ label, value, href, mono }: { label: string; value?: string; href?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = () => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex items-center gap-2 group">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className={`text-sm text-brand-500 hover:text-brand-600 break-all ${mono ? "font-mono" : ""}`}>
            {value}
          </a>
        ) : (
          <span className={`text-sm text-gray-700 dark:text-gray-200 break-all ${mono ? "font-mono" : ""}`}>{value}</span>
        )}
        <button onClick={copy}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
          {copied ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const tier = lead.tier as keyof typeof TIER_COLORS;
  const score = parseInt(lead.score) || 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* panel */}
      <div ref={drawerRef}
        className="w-full max-w-md bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-2xl flex flex-col animate-slide-in-right">
        {/* header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{lead.company_name || "Unknown Company"}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{lead.category}</p>
          </div>
          <button onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-6">
          {/* Score + Tier */}
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lead Quality</span>
              {tier && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TIER_COLORS[tier] ?? TIER_COLORS.D}`}>
                  Tier {tier} {tier === "A" ? "🏆" : tier === "B" ? "⭐" : tier === "C" ? "📌" : "📄"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold text-gray-900 dark:text-white">{score || "—"}</div>
              <div className="text-sm text-gray-400">/ 100</div>
            </div>
            {score > 0 && (
              <div className="mt-2 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                <div className={`h-2 rounded-full transition-all ${TIER_BAR[tier] ?? "bg-gray-400"}`} style={{ width: `${score}%` }} />
              </div>
            )}
            {!score && <p className="text-xs text-gray-400 mt-1">Score populates after next scraper run</p>}
          </div>

          {/* Contact */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Contact</h3>
            <div className="flex flex-col gap-3">
              <Field label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} mono />
              {lead.all_emails && lead.all_emails !== lead.email && (
                <Field label="All Emails" value={lead.all_emails} mono />
              )}
              <Field label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Field label="Website" value={lead.website} href={lead.website} />
              <Field label="LinkedIn" value={lead.linkedin} href={lead.linkedin} />
              {lead.facebook && <Field label="Facebook" value={lead.facebook} href={lead.facebook} />}
              {lead.instagram && <Field label="Instagram" value={lead.instagram} href={lead.instagram} />}
            </div>
          </section>

          {/* Location */}
          {lead.address && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Location</h3>
              <Field label="Address" value={lead.address} />
            </section>
          )}

          {/* Firmographics */}
          {(lead.rating || lead.review_count || lead.company_size || lead.hourly_rate || lead.min_project) && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Firmographics</h3>
              <div className="grid grid-cols-2 gap-3">
                {lead.rating && (
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{lead.rating} ⭐</div>
                    <div className="text-xs text-gray-400">{lead.review_count ? `${lead.review_count} reviews` : "Rating"}</div>
                  </div>
                )}
                {lead.company_size && (
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{lead.company_size}</div>
                    <div className="text-xs text-gray-400">Team size</div>
                  </div>
                )}
                {lead.hourly_rate && (
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{lead.hourly_rate}</div>
                    <div className="text-xs text-gray-400">Hourly rate</div>
                  </div>
                )}
                {lead.min_project && (
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{lead.min_project}</div>
                    <div className="text-xs text-gray-400">Min project</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Source metadata */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Source Metadata</h3>
            <div className="flex flex-col gap-3">
              <Field label="Source" value={SOURCE_LABELS[lead.source] ?? lead.source} />
              {lead.email_verified && <Field label="Email Verified" value={lead.email_verified} />}
              {lead.scraped_at && (
                <Field label="Scraped At" value={new Date(lead.scraped_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} />
              )}
              {lead.profile_url && <Field label="Profile URL" value={lead.profile_url} href={lead.profile_url} />}
            </div>
          </section>
        </div>

        {/* footer actions */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-5 py-4 flex gap-3 mt-auto">
          {lead.email && (
            <a href={`mailto:${lead.email}`}
              className="flex-1 text-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors">
              Send Email
            </a>
          )}
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Visit Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main table ────────────────────────────────────────────────────────────────

export default function LeadsTable({ leads }: { leads: Lead[] }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [emailOnly, setEmailOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<"score" | "scraped_at">("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const hasScores = leads.some((l) => l.score && l.tier);

  const allSources = useMemo(() => {
    const s = new Set(leads.map((l) => l.source).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (tierFilter !== "All") {
          if (!hasScores) return true; // no scores yet — show all in tier view
          if (l.tier !== tierFilter) return false;
        }
        if (sourceFilter !== "All" && l.source !== sourceFilter) return false;
        if (emailOnly && !l.email) return false;
        if (q) {
          const hay = `${l.company_name} ${l.email} ${l.address} ${l.category}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
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
  }, [leads, search, tierFilter, sourceFilter, emailOnly, sortCol, sortDir, hasScores]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageNum = Math.min(page, totalPages);
  const pageLeads = filtered.slice((safePageNum - 1) * PAGE_SIZE, safePageNum * PAGE_SIZE);

  const resetPage = () => setPage(1);

  const toggleSort = (col: "score" | "scraped_at") => {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
    resetPage();
  };

  const SortArrow = ({ col }: { col: "score" | "scraped_at" }) =>
    sortCol !== col ? (
      <span className="text-gray-300">↕</span>
    ) : sortDir === "desc" ? (
      <span className="text-brand-500">↓</span>
    ) : (
      <span className="text-brand-500">↑</span>
    );

  const selectCls = "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer";

  return (
    <>
      {/* Detail drawer */}
      {selectedLead && <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />}

      <div className="space-y-4">
        {/* ── Filter bar ── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search company, email, location…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 pl-9 pr-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); resetPage(); }} className={selectCls}>
              <option value="All">All Tiers</option>
              <option value="A">Tier A — Top</option>
              <option value="B">Tier B — Strong</option>
              <option value="C">Tier C — Qualified</option>
              <option value="D">Tier D — Weak</option>
            </select>

            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); resetPage(); }} className={selectCls}>
              {allSources.map((s) => (
                <option key={s} value={s}>{s === "All" ? "All Sources" : (SOURCE_LABELS[s] ?? s)}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none shrink-0">
              <input type="checkbox" checked={emailOnly} onChange={(e) => { setEmailOnly(e.target.checked); resetPage(); }}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-500 focus:ring-brand-500 bg-white dark:bg-gray-900" />
              Has Email
            </label>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-gray-400 whitespace-nowrap">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{filtered.length.toLocaleString()}</span> leads
              </span>
              <button onClick={() => exportCSV(filtered)}
                className="rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors">
                Export CSV
              </button>
            </div>
          </div>

          {!hasScores && tierFilter !== "All" && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              ⚠️ Scores are not yet computed — trigger a scraper run to populate tier data.
            </p>
          )}
        </div>

        {/* ── Table ── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-white/[0.02] text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Location</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Source</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
                    onClick={() => toggleSort("score")}>
                    Score <SortArrow col="score" />
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hidden xl:table-cell"
                    onClick={() => toggleSort("scraped_at")}>
                    Scraped <SortArrow col="scraped_at" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {pageLeads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-16 text-center text-gray-400">
                      <div className="text-3xl mb-2">🔍</div>
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
                      <tr key={i}
                        onClick={() => setSelectedLead(lead)}
                        className="hover:bg-brand-50/50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer group">
                        <td className="px-5 py-3.5 max-w-[200px]">
                          <div className="font-semibold text-gray-800 dark:text-white truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                            {lead.company_name || "—"}
                          </div>
                          {lead.category && (
                            <div className="text-xs text-gray-400 truncate mt-0.5">{lead.category}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 max-w-[180px]">
                          {lead.email ? (
                            <span onClick={(e) => e.stopPropagation()}>
                              <a href={`mailto:${lead.email}`}
                                className="block text-xs text-gray-600 dark:text-gray-300 hover:text-brand-500 truncate">
                                {lead.email}
                              </a>
                            </span>
                          ) : <span className="text-gray-300 dark:text-gray-600 text-xs">No email</span>}
                          {lead.phone && (
                            <div className="text-xs text-gray-400 truncate mt-0.5">{lead.phone}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-gray-500 dark:text-gray-400 max-w-[140px] truncate hidden md:table-cell">
                          {lead.address || "—"}
                        </td>
                        <td className="px-5 py-3.5 hidden lg:table-cell">
                          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {SOURCE_LABELS[lead.source] ?? (lead.source || "—")}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-bold text-gray-800 dark:text-white">
                          {lead.score || <span className="text-gray-300 dark:text-gray-600 text-xs font-normal">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {tier ? (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[tier] ?? TIER_COLORS.D}`}>{tier}</span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap hidden xl:table-cell">{scrapeDate}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.01]">
              <span className="text-xs text-gray-500">
                Showing {((safePageNum - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePageNum * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={safePageNum === 1}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">«</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePageNum === 1}
                  className="rounded px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                  Prev
                </button>
                <span className="px-3 py-1 text-xs text-gray-700 dark:text-gray-300 font-semibold">
                  {safePageNum} / {totalPages}
                </span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePageNum === totalPages}
                  className="rounded px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                  Next
                </button>
                <button onClick={() => setPage(totalPages)} disabled={safePageNum === totalPages}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">»</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
