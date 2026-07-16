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

// ── Region groups: matched against address + search_query ─────────────────────
const REGIONS: Record<string, string[]> = {
  "Middle East": [
    "uae","dubai","abu dhabi","sharjah","ajman","ras al","fujairah",
    "saudi","riyadh","jeddah","dammam","mecca","medina","khobar",
    "qatar","doha","kuwait","bahrain","manama","oman","muscat",
    "jordan","amman","lebanon","beirut","iraq","baghdad",
    "israel","tel aviv","haifa","palestine","egypt","cairo","alexandria",
    "yemen","syria","united arab","gcc",
  ],
  "South Asia": [
    "pakistan","karachi","lahore","islamabad","faisalabad","peshawar","quetta","multan",
    "india","bangalore","bengaluru","mumbai","delhi","hyderabad","pune","chennai",
    "kolkata","ahmedabad","surat","jaipur","lucknow","kochi",
    "bangladesh","dhaka","chittagong",
    "sri lanka","colombo","nepal","kathmandu",
  ],
  "Southeast Asia": [
    "singapore","philippines","manila","cebu","davao",
    "malaysia","kuala lumpur","kl","penang","johor",
    "vietnam","ho chi minh","hanoi","da nang",
    "indonesia","jakarta","bali","surabaya",
    "thailand","bangkok","chiang mai",
    "myanmar","rangoon","cambodia","phnom penh",
  ],
  "Africa": [
    "nigeria","lagos","abuja","port harcourt",
    "kenya","nairobi","mombasa",
    "south africa","cape town","johannesburg","durban","pretoria",
    "ghana","accra","ethiopia","addis ababa",
    "tanzania","dar es salaam","uganda","kampala",
    "morocco","casablanca","rabat","senegal","dakar","ivory coast",
  ],
  "Europe": [
    "uk","united kingdom","london","manchester","birmingham","glasgow","edinburgh",
    "germany","berlin","munich","hamburg","frankfurt","cologne","düsseldorf",
    "netherlands","amsterdam","rotterdam","the hague",
    "france","paris","lyon","marseille",
    "spain","madrid","barcelona","sweden","stockholm","norway","oslo",
    "denmark","copenhagen","finland","helsinki","poland","warsaw",
    "ukraine","kyiv","czech","prague","austria","vienna","switzerland","zurich",
    "italy","rome","milan","portugal","lisbon","belgium","brussels",
  ],
  "North America": [
    "usa","united states","new york","san francisco","silicon valley","los angeles",
    "seattle","austin","chicago","boston","miami","dallas","denver","atlanta",
    "canada","toronto","vancouver","montreal","calgary","ottawa",
    "mexico","mexico city","guadalajara",
  ],
  "APAC / ANZ": [
    "australia","sydney","melbourne","brisbane","perth","adelaide",
    "new zealand","auckland","wellington",
    "japan","tokyo","osaka","south korea","seoul","busan",
    "taiwan","taipei","hong kong","china","beijing","shanghai","shenzhen",
  ],
};

// ── Service keyword groups: matched against category + search_query + company_name ──
const SERVICES: Record<string, string[]> = {
  "Data Analytics / BI": [
    "data","analytics","bi","power bi","powerbi","dashboard","reporting",
    "visualization","tableau","looker","qlik","business intelligence",
    "data science","data engineer","data warehouse","etl","snowflake",
    "dbt","metabase","superset","grafana",
  ],
  "Web Development": [
    "web","frontend","react","angular","vue","next","nuxt",
    "wordpress","cms","portal","landing page","website",
  ],
  "Mobile Apps": [
    "mobile","ios","android","flutter","react native","app development",
    "swift","kotlin","xamarin","ionic",
  ],
  "AI / ML": [
    "ai","artificial intelligence","machine learning","ml","nlp",
    "computer vision","deep learning","llm","gpt","chatbot",
    "generative ai","neural","predictive",
  ],
  "E-commerce": [
    "ecommerce","e-commerce","shopify","magento","woocommerce",
    "online store","marketplace","woo","prestashop","bigcommerce",
  ],
  "Cloud / DevOps": [
    "cloud","devops","aws","azure","gcp","docker","kubernetes",
    "infrastructure","ci/cd","devsecops","terraform","ansible",
  ],
  "Cybersecurity": [
    "cyber","security","penetration","firewall","soc","compliance",
    "iso 27001","siem","endpoint","threat",
  ],
  "ERP / SAP": [
    "erp","sap","odoo","oracle","dynamics","netsuite",
    "enterprise resource","accounting","erp system",
  ],
  "Blockchain": [
    "blockchain","crypto","web3","nft","defi","smart contract","ethereum",
  ],
  "UI/UX Design": [
    "design","ux","ui","user experience","figma","prototyping","creative",
  ],
  "QA / Testing": [
    "qa","testing","quality assurance","test automation","selenium",
    "cypress","playwright","performance testing","load testing",
  ],
  "Digital Marketing": [
    "digital marketing","seo","sem","ppc","social media","content marketing",
    "email marketing","growth hacking","performance marketing",
  ],
};

function matchesRegion(lead: Lead, region: string): boolean {
  const keywords = REGIONS[region];
  const hay = `${lead.address} ${lead.search_query}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

function matchesService(lead: Lead, service: string): boolean {
  const keywords = SERVICES[service];
  const hay = `${lead.category} ${lead.search_query} ${lead.company_name}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

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
        </div>
      </div>
    </div>
  );
}

// ── Quick-target presets ──────────────────────────────────────────────────────

type Preset = { label: string; region: string; service: string; tier: string };

const QUICK_TARGETS: Preset[] = [
  { label: "Data Analytics · ME",       region: "Middle East",    service: "Data Analytics / BI",  tier: "All" },
  { label: "PowerBI / BI · ME",         region: "Middle East",    service: "Data Analytics / BI",  tier: "All" },
  { label: "AI/ML · South Asia",        region: "South Asia",     service: "AI / ML",              tier: "All" },
  { label: "Mobile Apps · SE Asia",     region: "Southeast Asia", service: "Mobile Apps",          tier: "All" },
  { label: "E-commerce · Africa",       region: "Africa",         service: "E-commerce",           tier: "All" },
  { label: "ERP/SAP · ME Tier A",       region: "Middle East",    service: "ERP / SAP",            tier: "A"   },
  { label: "Web Dev · Europe",          region: "Europe",         service: "Web Development",      tier: "All" },
  { label: "Cloud/DevOps · US",         region: "North America",  service: "Cloud / DevOps",       tier: "All" },
];

// ── Main table ────────────────────────────────────────────────────────────────

export default function LeadsTable({ leads }: { leads: Lead[] }) {
  const [search, setSearch]           = useState("");
  const [tierFilter, setTierFilter]   = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [regionFilter, setRegionFilter] = useState("All");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [emailOnly, setEmailOnly]     = useState(false);
  const [page, setPage]               = useState(1);
  const [sortCol, setSortCol]         = useState<"score" | "scraped_at">("score");
  const [sortDir, setSortDir]         = useState<"desc" | "asc">("desc");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  const hasScores = leads.some((l) => l.score && l.tier);

  const allSources = useMemo(() => {
    const s = new Set(leads.map((l) => l.source).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [leads]);

  const activeFilterCount = [
    tierFilter !== "All",
    sourceFilter !== "All",
    regionFilter !== "All",
    serviceFilter !== "All",
    emailOnly,
    search.trim() !== "",
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (tierFilter !== "All") {
          if (!hasScores) return true;
          if (l.tier !== tierFilter) return false;
        }
        if (sourceFilter !== "All" && l.source !== sourceFilter) return false;
        if (regionFilter !== "All" && !matchesRegion(l, regionFilter)) return false;
        if (serviceFilter !== "All" && !matchesService(l, serviceFilter)) return false;
        if (emailOnly && !l.email) return false;
        if (q) {
          const hay = `${l.company_name} ${l.email} ${l.address} ${l.category} ${l.search_query}`.toLowerCase();
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
  }, [leads, search, tierFilter, sourceFilter, regionFilter, serviceFilter, emailOnly, sortCol, sortDir, hasScores]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePageNum = Math.min(page, totalPages);
  const pageLeads = filtered.slice((safePageNum - 1) * PAGE_SIZE, safePageNum * PAGE_SIZE);

  const resetPage = () => setPage(1);

  const applyPreset = (p: Preset) => {
    setRegionFilter(p.region);
    setServiceFilter(p.service);
    setTierFilter(p.tier);
    setSearch("");
    setSourceFilter("All");
    setEmailOnly(false);
    setShowPresets(false);
    resetPage();
  };

  const clearAllFilters = () => {
    setSearch(""); setTierFilter("All"); setSourceFilter("All");
    setRegionFilter("All"); setServiceFilter("All"); setEmailOnly(false);
    resetPage();
  };

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
      {selectedLead && <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />}

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
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 pl-9 pr-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-400 whitespace-nowrap">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{filtered.length.toLocaleString()}</span> leads
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

              <button onClick={() => exportCSV(filtered)}
                className="rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap">
                Export CSV
              </button>
            </div>
          </div>

          {/* Row 2: dropdown filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Tier */}
            <select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); resetPage(); }} className={selectCls}>
              <option value="All">All Tiers</option>
              <option value="A">Tier A — Top</option>
              <option value="B">Tier B — Strong</option>
              <option value="C">Tier C — Qualified</option>
              <option value="D">Tier D — Weak</option>
            </select>

            {/* Source */}
            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); resetPage(); }} className={selectCls}>
              {allSources.map((s) => (
                <option key={s} value={s}>{s === "All" ? "All Sources" : (SOURCE_LABELS[s] ?? s)}</option>
              ))}
            </select>

            {/* Region */}
            <select value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); resetPage(); }}
              className={`${selectCls} ${regionFilter !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Regions</option>
              {Object.keys(REGIONS).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            {/* Service / Specialty */}
            <select value={serviceFilter} onChange={(e) => { setServiceFilter(e.target.value); resetPage(); }}
              className={`${selectCls} ${serviceFilter !== "All" ? "border-brand-400 ring-1 ring-brand-300 text-brand-600 dark:text-brand-400" : ""}`}>
              <option value="All">All Services</option>
              {Object.keys(SERVICES).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Has Email */}
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none shrink-0">
              <input type="checkbox" checked={emailOnly} onChange={(e) => { setEmailOnly(e.target.checked); resetPage(); }}
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
          {(regionFilter !== "All" || serviceFilter !== "All") && (
            <div className="flex flex-wrap gap-2 pt-1">
              {regionFilter !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                  📍 {regionFilter}
                  <button onClick={() => { setRegionFilter("All"); resetPage(); }} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
              {serviceFilter !== "All" && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                  🔧 {serviceFilter}
                  <button onClick={() => { setServiceFilter("All"); resetPage(); }} className="hover:text-red-500 transition-colors">×</button>
                </span>
              )}
            </div>
          )}

          {!hasScores && tierFilter !== "All" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
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
                      {activeFilterCount > 0 && (
                        <button onClick={clearAllFilters} className="block mx-auto mt-2 text-sm text-brand-500 hover:underline">
                          Clear all filters
                        </button>
                      )}
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
