"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Lead } from "@/lib/lead-types";
import { SOURCE_LABELS } from "@/lib/lead-types";
import { INDUSTRIES, REGIONS, COUNTRIES, CITIES, FIRM_SIZE_BANDS } from "@/lib/facets";

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  D: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const TIER_BAR: Record<string, string> = {
  A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-400", D: "bg-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  qualified: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  converted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const REGION_LABELS: Record<string, string> = Object.fromEntries(REGIONS.map((r) => [r.slug, r.label]));
const INDUSTRY_LABELS: Record<string, string> = Object.fromEntries(INDUSTRIES.map((i) => [i.slug, i.label]));
const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.slug, c.label]));
const CITY_LABELS: Record<string, string> = Object.fromEntries(CITIES.map((c) => [c.slug, c.label]));

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

function LeadDrawer({
  lead,
  onClose,
  onStatusChange,
  onDelete,
}: {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const tier = lead.tier as keyof typeof TIER_COLORS;
  const score = parseInt(lead.score) || 0;
  const [statusSaving, setStatusSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleStatusChange = async (status: string) => {
    if (!lead.id) return;
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) onStatusChange(lead.id, status);
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setStatusSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!lead.id) return;
    if (!window.confirm(`Remove ${lead.company_name || "this lead"} from the list?`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      if (res.ok) {
        onDelete(lead.id);
        onClose();
      }
    } catch (err) {
      console.error("Failed to remove lead:", err);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div ref={drawerRef}
        className="w-full max-w-md bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-2xl flex flex-col animate-slide-in-right">
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
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status</span>
              <select
                value={lead.status}
                disabled={statusSaving || !lead.id}
                onChange={(e) => handleStatusChange(e.target.value)}
                className={`text-xs font-bold px-2.5 py-1 rounded-full border-0 cursor-pointer disabled:opacity-50 ${STATUS_COLORS[lead.status] ?? STATUS_COLORS.new}`}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

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

          {lead.address && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Location</h3>
              <Field label="Address" value={lead.address} />
              {lead.region && <Field label="Region" value={REGION_LABELS[lead.region] ?? lead.region} />}
              {lead.country && <Field label="Country" value={COUNTRY_LABELS[lead.country] ?? lead.country} />}
              {lead.city && <Field label="City" value={CITY_LABELS[lead.city] ?? lead.city} />}
            </section>
          )}

          {(lead.industry || (lead.tags && lead.tags.length > 0) || lead.firm_size_band) && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Classification</h3>
              <div className="flex flex-wrap gap-1.5">
                {lead.industry && (
                  <span className="inline-flex items-center rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                    {INDUSTRY_LABELS[lead.industry] ?? lead.industry}
                  </span>
                )}
                {(lead.tags ?? [])
                  .filter((t) => t !== lead.industry)
                  .map((t) => (
                    <span key={t} className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                      {INDUSTRY_LABELS[t] ?? t}
                    </span>
                  ))}
                {lead.firm_size_band && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                    {lead.is_enterprise ? "Enterprise" : lead.firm_size_band}
                    {lead.employee_count ? ` · ${lead.employee_count.toLocaleString()} employees` : ""}
                  </span>
                )}
              </div>
            </section>
          )}

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
          <button onClick={handleRemove} disabled={removing || !lead.id}
            className="shrink-0 rounded-lg border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50">
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick-target presets (industry/region slugs match the shared taxonomy) ────

type Preset = { label: string; region: string; industry: string; tier: string };

const QUICK_TARGETS: Preset[] = [
  { label: "Data Analytics · ME",       region: "middle-east",     industry: "data-analytics-bi", tier: "All" },
  { label: "AI/ML · South Asia",        region: "south-asia",      industry: "ai-ml",             tier: "All" },
  { label: "Mobile Apps · SE Asia",     region: "southeast-asia",  industry: "mobile-apps",       tier: "All" },
  { label: "E-commerce · Africa",       region: "africa",          industry: "ecommerce",         tier: "All" },
  { label: "ERP/SAP · ME Tier A",       region: "middle-east",     industry: "erp-sap",           tier: "A"   },
  { label: "Web Dev · Europe",          region: "europe",          industry: "web-development",   tier: "All" },
  { label: "Cloud/DevOps · US",         region: "north-america",   industry: "cloud-devops",      tier: "All" },
  { label: "Digital Marketing · Global", region: "All",            industry: "digital-marketing", tier: "All" },
];

// ── Fetch helpers ───────────────────────────────────────────────────────────

type Filters = {
  search: string;
  tier: string;
  source: string;
  region: string;
  country: string;
  city: string;
  leadType: string;
  industry: string;
  firmSizeBand: string;
  emailOnly: boolean;
  minScore: string;
  maxScore: string;
  sortCol: "score" | "scraped_at";
  sortDir: "desc" | "asc";
};

const DEFAULT_FILTERS: Filters = {
  // leadType defaults to "buyer", not "All" — the now-disabled vendor-only
  // sources (Clutch/GoodFirms/etc.) left ~4,135 vendor leads already synced
  // to Supabase, and the product's ICP is buyers. "All" is still a real,
  // one-click dropdown option for anyone who wants to see vendors mixed in;
  // this only changes what a customer sees on first load. Leave the
  // leadType=undefined handling in the API routes alone — that's what makes
  // selecting "All" here actually work (see filtersToFilterJson below).
  search: "", tier: "All", source: "All", region: "All", city: "All", country: "All", leadType: "buyer", industry: "All",
  firmSizeBand: "All", emailOnly: false, minScore: "", maxScore: "",
  sortCol: "score", sortDir: "desc",
};

function filtersToFilterJson(filters: Filters) {
  return {
    tier: filters.tier !== "All" ? filters.tier : undefined,
    source: filters.source !== "All" ? filters.source : undefined,
    region: filters.region !== "All" ? filters.region : undefined,
    country: filters.country !== "All" ? filters.country : undefined,
    city: filters.city !== "All" ? filters.city : undefined,
    leadType: filters.leadType !== "All" ? filters.leadType : undefined,
    industry: filters.industry !== "All" ? filters.industry : undefined,
    firmSizeBand: filters.firmSizeBand !== "All" ? filters.firmSizeBand : undefined,
    hasEmail: filters.emailOnly || undefined,
    minScore: filters.minScore ? Number(filters.minScore) : undefined,
    maxScore: filters.maxScore ? Number(filters.maxScore) : undefined,
    search: filters.search.trim() || undefined,
    sortCol: filters.sortCol,
    sortDir: filters.sortDir,
  };
}

function buildParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.tier !== "All") params.set("tier", filters.tier);
  if (filters.source !== "All") params.set("source", filters.source);
  if (filters.region !== "All") params.set("region", filters.region);
  if (filters.country !== "All") params.set("country", filters.country);
  if (filters.city !== "All") params.set("city", filters.city);
  if (filters.leadType !== "All") params.set("leadType", filters.leadType);
  if (filters.industry !== "All") params.set("industry", filters.industry);
  if (filters.firmSizeBand !== "All") params.set("firmSizeBand", filters.firmSizeBand);
  if (filters.emailOnly) params.set("hasEmail", "1");
  if (filters.minScore) params.set("minScore", filters.minScore);
  if (filters.maxScore) params.set("maxScore", filters.maxScore);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  params.set("sortCol", filters.sortCol);
  params.set("sortDir", filters.sortDir);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  return params;
}

// ── Main table ────────────────────────────────────────────────────────────────

type InitialQuery = {
  tier?: string;
  source?: string;
  industry?: string;
  region?: string;
  country?: string;
  city?: string;
  leadType?: string;
  firmSizeBand?: string;
  minScore?: number;
  maxScore?: number;
  hasEmail?: boolean;
  search?: string;
  sortCol?: "score" | "scraped_at";
  sortDir?: "asc" | "desc";
};

function filtersFromInitialQuery(q?: InitialQuery): Filters {
  if (!q) return DEFAULT_FILTERS;
  return {
    search: q.search ?? "",
    tier: q.tier ?? "All",
    source: q.source ?? "All",
    region: q.region ?? "All",
    country: q.country ?? "All",
    city: q.city ?? "All",
    // Same "buyer" default as DEFAULT_FILTERS above, and for the same
    // reason — this is the fallback that actually applies on first page
    // load (server-rendered initial query from URL search params), which
    // DEFAULT_FILTERS alone does not cover once `q` is defined.
    leadType: q.leadType ?? "buyer",
    industry: q.industry ?? "All",
    firmSizeBand: q.firmSizeBand ?? "All",
    emailOnly: q.hasEmail ?? false,
    minScore: q.minScore != null ? String(q.minScore) : "",
    maxScore: q.maxScore != null ? String(q.maxScore) : "",
    sortCol: q.sortCol ?? "score",
    sortDir: q.sortDir ?? "desc",
  };
}

export default function LeadsTable({
  initialLeads,
  initialTotal,
  sources,
  initialQuery,
}: {
  initialLeads: Lead[];
  initialTotal: number;
  sources: string[];
  initialQuery?: InitialQuery;
}) {
  const [filters, setFilters] = useState<Filters>(() => filtersFromInitialQuery(initialQuery));
  const [searchInput, setSearchInput] = useState(initialQuery?.search ?? "");
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const isFirstRun = useRef(true);
  const requestIdRef = useRef(0);

  const allSources = useMemo(() => ["All", ...sources], [sources]);

  // Debounce the search box into filters.search
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch whenever filters or page change (skip the very first run — the
  // server component already fetched the default first page).
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const params = buildParams(filters, page);
    fetch(`/api/leads?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { leads: Lead[]; total: number }) => {
        if (requestId !== requestIdRef.current) return; // a newer request superseded this one
        setLeads(data.leads);
        setTotal(data.total);
      })
      .catch((err) => console.error("Failed to fetch leads:", err))
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [filters, page]);

  const activeFilterCount = [
    filters.tier !== "All",
    filters.source !== "All",
    filters.region !== "All",
    filters.country !== "All",
    filters.city !== "All",
    filters.leadType !== "All",
    filters.industry !== "All",
    filters.firmSizeBand !== "All",
    filters.emailOnly,
    !!filters.minScore,
    !!filters.maxScore,
    filters.search.trim() !== "",
  ].filter(Boolean).length;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  // Changing country invalidates a previously-picked city from a different
  // country (a stale city filter would just zero out the results silently).
  const setCountryFilter = (value: string) => {
    setFilters((f) => ({ ...f, country: value, city: "All" }));
    setPage(1);
  };

  // Once a country is picked, narrow the city dropdown to that country's
  // cities so picking one can't produce a combination with zero matches.
  const cityOptions = filters.country !== "All"
    ? CITIES.filter((c) => c.country === filters.country)
    : CITIES;

  const applyPreset = (p: Preset) => {
    setFilters({
      ...DEFAULT_FILTERS,
      region: p.region,
      industry: p.industry,
      tier: p.tier,
    });
    setSearchInput("");
    setShowPresets(false);
    setPage(1);
  };

  const clearAllFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchInput("");
    setPage(1);
  };

  const toggleSort = (col: "score" | "scraped_at") => {
    setFilters((f) => ({
      ...f,
      sortCol: col,
      sortDir: f.sortCol === col ? (f.sortDir === "desc" ? "asc" : "desc") : "desc",
    }));
    setPage(1);
  };

  const exportCSV = () => {
    const params = buildParams(filters, 1);
    params.delete("page");
    params.delete("pageSize");
    window.location.href = `/api/leads/export?${params.toString()}`;
  };

  const saveSearch = async () => {
    if (!saveName.trim()) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), filter_json: filtersToFilterJson(filters) }),
      });
      if (!res.ok) throw new Error("Failed to save search");
      setSaveStatus("saved");
      setSaveName("");
      setTimeout(() => {
        setShowSavePrompt(false);
        setSaveStatus("idle");
      }, 1200);
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
    }
  };

  const SortArrow = ({ col }: { col: "score" | "scraped_at" }) =>
    filters.sortCol !== col ? (
      <span className="text-gray-300">↕</span>
    ) : filters.sortDir === "desc" ? (
      <span className="text-brand-500">↓</span>
    ) : (
      <span className="text-brand-500">↑</span>
    );

  const selectCls = "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer";

  return (
    <>
      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStatusChange={(id, status) => {
            setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
            setSelectedLead((prev) => (prev && prev.id === id ? { ...prev, status } : prev));
          }}
          onDelete={(id) => {
            setLeads((prev) => prev.filter((l) => l.id !== id));
            setTotal((t) => Math.max(0, t - 1));
          }}
        />
      )}

      <div className="space-y-4">
        {/* ── Filter panel ── */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-4 space-y-3">

          {/* Row 1: search + result count + presets + export */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search company, email, location, category…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 pl-9 pr-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-400 whitespace-nowrap">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{total.toLocaleString()}</span> leads
                {loading && <span className="ml-1.5 inline-block animate-pulse text-brand-400">·</span>}
              </span>

              {/* Quick targets button */}
              <div className="relative">
                <button
                  onClick={() => setShowPresets((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Quick Targets
                </button>
                {showPresets && (
                  <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1">
                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Preset Filter Combinations</p>
                    {QUICK_TARGETS.map((p) => (
                      <button key={p.label} onClick={() => applyPreset(p)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-brand-50 dark:hover:bg-brand-900/20 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                        {p.label}
                        {p.tier !== "All" && <span className="ml-1 text-xs text-emerald-600">· Tier {p.tier}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button onClick={() => setShowSavePrompt((v) => !v)}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap">
                  Save Search
                </button>
                {showSavePrompt && (
                  <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Name this search</p>
                    <input
                      type="text"
                      autoFocus
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveSearch()}
                      placeholder="e.g. AI/ML · South Asia · Tier A"
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    {saveStatus === "error" && (
                      <p className="text-xs text-error-500">Couldn&apos;t save — are you signed in?</p>
                    )}
                    <button
                      onClick={saveSearch}
                      disabled={saveStatus === "saving" || !saveName.trim()}
                      className="w-full rounded-lg bg-brand-500 hover:bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50">
                      {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save"}
                    </button>
                  </div>
                )}
              </div>

              <button onClick={exportCSV}
                className="rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap">
                Export CSV
              </button>
            </div>
          </div>

          {/* Row 2: dropdown filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Tier */}
            <select value={filters.tier} onChange={(e) => setFilter("tier", e.target.value)} className={selectCls}>
              <option value="All">All Tiers</option>
              <option value="A">Tier A — Top</option>
              <option value="B">Tier B — Strong</option>
              <option value="C">Tier C — Qualified</option>
              <option value="D">Tier D — Weak</option>
            </select>

            {/* Source */}
            <select value={filters.source} onChange={(e) => setFilter("source", e.target.value)} className={selectCls}>
              {allSources.map((s) => (
                <option key={s} value={s}>{s === "All" ? "All Sources" : (SOURCE_LABELS[s] ?? s)}</option>
              ))}
            </select>

            {/* Region */}
            <select value={filters.region} onChange={(e) => setFilter("region", e.target.value)}
              className={`${selectCls} ${filters.region !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Regions</option>
              {REGIONS.map((r) => <option key={r.slug} value={r.slug}>{r.label}</option>)}
            </select>

            {/* Country */}
            <select value={filters.country} onChange={(e) => setCountryFilter(e.target.value)}
              className={`${selectCls} ${filters.country !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Countries</option>
              {COUNTRIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>

            {/* City — narrowed to the selected country's cities, if any */}
            <select value={filters.city} onChange={(e) => setFilter("city", e.target.value)}
              className={`${selectCls} ${filters.city !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Cities</option>
              {cityOptions.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>

            {/* Lead type — buyer vs vendor, see memory.md's seller/buyer problem */}
            <select value={filters.leadType} onChange={(e) => setFilter("leadType", e.target.value)}
              className={`${selectCls} ${filters.leadType !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">Buyers &amp; Vendors</option>
              <option value="buyer">Buyers only</option>
              <option value="vendor">Vendors only</option>
            </select>

            {/* Industry */}
            <select value={filters.industry} onChange={(e) => setFilter("industry", e.target.value)}
              className={`${selectCls} ${filters.industry !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Industries</option>
              {INDUSTRIES.map((i) => <option key={i.slug} value={i.slug}>{i.label}</option>)}
            </select>

            {/* Firm size */}
            <select value={filters.firmSizeBand} onChange={(e) => setFilter("firmSizeBand", e.target.value)} className={selectCls}>
              <option value="All">All Sizes</option>
              {FIRM_SIZE_BANDS.map((b) => <option key={b.band} value={b.band}>{b.label}</option>)}
            </select>

            {/* Score range */}
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={100} placeholder="Min score" value={filters.minScore}
                onChange={(e) => setFilter("minScore", e.target.value)}
                className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="text-gray-300 text-sm">–</span>
              <input type="number" min={0} max={100} placeholder="Max score" value={filters.maxScore}
                onChange={(e) => setFilter("maxScore", e.target.value)}
                className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>

            {/* Has Email */}
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none shrink-0">
              <input type="checkbox" checked={filters.emailOnly} onChange={(e) => setFilter("emailOnly", e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-500 focus:ring-brand-500 bg-white dark:bg-gray-900" />
              Has Email
            </label>

            {/* Clear all — only when something is active */}
            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {/* Active filter pills */}
          {(filters.region !== "All" || filters.country !== "All" || filters.city !== "All" || filters.leadType !== "All" || filters.industry !== "All") && (
            <div className="flex flex-wrap gap-2 pt-1">
              {filters.region !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                  📍 {REGION_LABELS[filters.region] ?? filters.region}
                  <button onClick={() => setFilter("region", "All")} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
              {filters.country !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                  🌍 {COUNTRY_LABELS[filters.country] ?? filters.country}
                  <button onClick={() => setCountryFilter("All")} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
              {filters.city !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                  🏙️ {CITY_LABELS[filters.city] ?? filters.city}
                  <button onClick={() => setFilter("city", "All")} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
              {filters.leadType !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {filters.leadType === "buyer" ? "🛒 Buyers only" : "🏭 Vendors only"}
                  <button onClick={() => setFilter("leadType", "All")} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
              {filters.industry !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                  🔧 {INDUSTRY_LABELS[filters.industry] ?? filters.industry}
                  <button onClick={() => setFilter("industry", "All")} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
            </div>
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
                {leads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-16 text-center text-gray-400">
                      <div className="text-3xl mb-2">🔍</div>
                      {loading ? "Loading…" : "No leads match your filters."}
                      {!loading && activeFilterCount > 0 && (
                        <button onClick={clearAllFilters} className="block mx-auto mt-2 text-sm text-brand-500 hover:underline">
                          Clear all filters
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  leads.map((lead, i) => {
                    const tier = lead.tier as keyof typeof TIER_COLORS;
                    const scrapeDate = lead.scraped_at
                      ? new Date(lead.scraped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "—";
                    return (
                      <tr key={i}
                        onClick={() => setSelectedLead(lead)}
                        className="hover:bg-brand-50/50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer group">
                        <td className="px-5 py-3.5 max-w-[200px]">
                          <div className="flex items-center gap-1.5">
                            <div className="font-semibold text-gray-800 dark:text-white truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                              {lead.company_name || "—"}
                            </div>
                            {lead.lead_type === "vendor" && (
                              <span title="Sells the service it was scraped under, not a buyer" className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Vendor</span>
                            )}
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
                          <div className="flex items-center gap-1.5">
                            {tier ? (
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[tier] ?? TIER_COLORS.D}`}>{tier}</span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            )}
                            {lead.status && lead.status !== "new" && (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[lead.status] ?? STATUS_COLORS.new}`}>
                                {STATUS_LABELS[lead.status] ?? lead.status}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap hidden xl:table-cell">{scrapeDate}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.01]">
              <span className="text-xs text-gray-500">
                Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">«</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="rounded px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                  Prev
                </button>
                <span className="px-3 py-1 text-xs text-gray-700 dark:text-gray-300 font-semibold">
                  {page} / {totalPages}
                </span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="rounded px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">
                  Next
                </button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30">»</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
