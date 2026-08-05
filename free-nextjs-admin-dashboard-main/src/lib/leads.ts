import type { Lead } from "./lead-types";
import { getSupabaseServerClient } from "./supabase/server";
export type { Lead } from "./lead-types";
export { SOURCE_LABELS } from "./lead-types";

export type LeadRow = {
  id: number | null;
  status: string | null;
  company_name: string | null;
  category: string | null;
  website: string | null;
  email: string | null;
  all_emails: string | null;
  phone: string | null;
  address: string | null;
  linkedin: string | null;
  facebook: string | null;
  instagram: string | null;
  rating: number | null;
  review_count: number | null;
  company_size: string | null;
  hourly_rate: string | null;
  min_project: string | null;
  search_query: string | null;
  profile_url: string | null;
  source: string | null;
  engine: string | null;
  email_verified: string | null;
  score: number | null;
  tier: string | null;
  scraped_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  industry: string | null;
  tags: string[] | null;
  sub_industries: string[] | null;
  employee_count: number | null;
  firm_size_band: string | null;
  is_enterprise: boolean | null;
  tag_confidence: number | null;
  tag_source: string | null;
  region: string | null;
};

// DB columns are properly typed (numeric/int); the rest of the app expects
// the CSV-era string shape, so normalize here rather than touching every consumer.
export function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id ?? null,
    status: row.status ?? "new",
    company_name: row.company_name ?? "",
    category: row.category ?? "",
    website: row.website ?? "",
    email: row.email ?? "",
    all_emails: row.all_emails ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    linkedin: row.linkedin ?? "",
    facebook: row.facebook ?? "",
    instagram: row.instagram ?? "",
    rating: row.rating != null ? String(row.rating) : "",
    review_count: row.review_count != null ? String(row.review_count) : "",
    company_size: row.company_size ?? "",
    hourly_rate: row.hourly_rate ?? "",
    min_project: row.min_project ?? "",
    search_query: row.search_query ?? "",
    profile_url: row.profile_url ?? "",
    source: row.source ?? "",
    engine: row.engine ?? "",
    email_verified: row.email_verified ?? "",
    score: row.score != null ? String(row.score) : "",
    tier: row.tier ?? "",
    scraped_at: row.scraped_at ?? "",
    first_seen_at: row.first_seen_at ?? "",
    last_seen_at: row.last_seen_at ?? "",
    industry: row.industry ?? null,
    tags: row.tags ?? [],
    sub_industries: row.sub_industries ?? [],
    employee_count: row.employee_count ?? null,
    firm_size_band: row.firm_size_band ?? null,
    is_enterprise: row.is_enterprise ?? false,
    tag_confidence: row.tag_confidence ?? null,
    tag_source: row.tag_source ?? null,
    region: row.region ?? null,
  };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csv: string): Lead[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    if (!obj.score) obj.score = "";
    if (!obj.tier) obj.tier = "";
    if (!obj.status) obj.status = "new";
    return obj as unknown as Lead;
  });
}

const SUPABASE_PAGE_SIZE = 1000; // PostgREST's default/max row cap per request

export const LEAD_SELECT_COLUMNS =
  "id, status, company_name, category, website, email, all_emails, phone, address, linkedin, facebook, instagram, rating, review_count, company_size, hourly_rate, min_project, search_query, profile_url, source, engine, email_verified, score, tier, scraped_at, first_seen_at, last_seen_at, industry, tags, sub_industries, employee_count, firm_size_band, is_enterprise, tag_confidence, tag_source, region";

async function fetchAllLeadRows(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>
): Promise<LeadRow[] | null> {
  const rows: LeadRow[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_SELECT_COLUMNS)
      .order("score", { ascending: false, nullsFirst: false })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      console.error("Supabase fetchLeads failed:", error.message);
      return null;
    }
    const page = data as LeadRow[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchLeads(): Promise<Lead[]> {
  // ── Primary: Supabase (populated by the weekly scraper's upsert) ────────────
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const rows = await fetchAllLeadRows(supabase);
    if (rows) return rows.map(rowToLead);
  }

  // ── Local dev fallback: read directly from filesystem ───────────────────────
  const localPath = process.env.LOCAL_CSV_PATH;
  if (localPath) {
    try {
      // Dynamic require so this module stays importable in client bundles
      // (the branch is never executed in the browser — env var is server-only)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      const csv = fs.readFileSync(localPath, "utf8");
      return parseCSV(csv);
    } catch (err) {
      console.error("LOCAL_CSV_PATH set but file not readable:", err);
      return [];
    }
  }

  // ── Production: fetch from GitHub raw ──────────────────────────────────────
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo) return [];

  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/output/leads-master.csv`;
  const headers: HeadersInit = { Accept: "text/plain" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(url, { headers, next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const csv = await res.text();
    return parseCSV(csv);
  } catch {
    return [];
  }
}

// ── Server-side filtered/paginated/sorted query (roadmap Phase 4.1) ──────────
// Every filter here is a plain WHERE clause when Supabase is configured, so
// the whole thing is expressible as a URL/query object the backend executes
// (GET /api/leads route below). When Supabase isn't configured, the same
// filters are applied in memory over the CSV fallback so local dev / the
// GitHub-raw production fallback keep working identically, just without the
// DB doing the heavy lifting.
export type LeadsQuery = {
  tier?: string;
  source?: string;
  industry?: string;
  tag?: string;
  region?: string;
  firmSizeBand?: string;
  minScore?: number;
  maxScore?: number;
  hasEmail?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortCol?: "score" | "scraped_at";
  sortDir?: "asc" | "desc";
};

export type LeadsQueryResult = {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
};

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function normalizeQuery(q: LeadsQuery) {
  return {
    ...q,
    page: Math.max(1, q.page ?? 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? DEFAULT_PAGE_SIZE)),
    sortCol: q.sortCol === "scraped_at" ? ("scraped_at" as const) : ("score" as const),
    sortDir: q.sortDir === "asc" ? ("asc" as const) : ("desc" as const),
  };
}

function matchesQueryInMemory(lead: Lead, q: ReturnType<typeof normalizeQuery>): boolean {
  if (q.tier && lead.tier !== q.tier) return false;
  if (q.source && lead.source !== q.source) return false;
  if (q.industry && lead.industry !== q.industry) return false;
  if (q.tag && !(lead.tags ?? []).includes(q.tag)) return false;
  if (q.region && lead.region !== q.region) return false;
  if (q.firmSizeBand && lead.firm_size_band !== q.firmSizeBand) return false;
  if (q.minScore != null && (parseInt(lead.score) || 0) < q.minScore) return false;
  if (q.maxScore != null && (parseInt(lead.score) || 0) > q.maxScore) return false;
  if (q.hasEmail && !lead.email) return false;
  if (q.search) {
    const hay = `${lead.company_name} ${lead.email} ${lead.address} ${lead.category} ${lead.search_query}`.toLowerCase();
    if (!hay.includes(q.search.trim().toLowerCase())) return false;
  }
  return true;
}

function sortLeadsInMemory(leads: Lead[], q: ReturnType<typeof normalizeQuery>): Lead[] {
  return [...leads].sort((a, b) => {
    const diff =
      q.sortCol === "score"
        ? (parseInt(b.score) || 0) - (parseInt(a.score) || 0)
        : (b.scraped_at ?? "").localeCompare(a.scraped_at ?? "");
    return q.sortDir === "desc" ? diff : -diff;
  });
}

export async function queryLeads(rawQuery: LeadsQuery): Promise<LeadsQueryResult> {
  const q = normalizeQuery(rawQuery);

  const supabase = await getSupabaseServerClient();
  if (supabase) {
    let query = supabase.from("leads").select(LEAD_SELECT_COLUMNS, { count: "exact" });
    if (q.tier) query = query.eq("tier", q.tier);
    if (q.source) query = query.eq("source", q.source);
    if (q.industry) query = query.eq("industry", q.industry);
    if (q.tag) query = query.contains("tags", [q.tag]);
    if (q.region) query = query.eq("region", q.region);
    if (q.firmSizeBand) query = query.eq("firm_size_band", q.firmSizeBand);
    if (q.minScore != null) query = query.gte("score", q.minScore);
    if (q.maxScore != null) query = query.lte("score", q.maxScore);
    if (q.hasEmail) query = query.not("email", "is", null).neq("email", "");
    if (q.search) {
      // Escape PostgREST's ilike wildcards so a literal "%"/"," in the search
      // box can't widen the match or break the .or() filter-string syntax.
      const s = q.search.trim().replace(/[%_,]/g, "\\$&");
      if (s) {
        query = query.or(
          `company_name.ilike.%${s}%,email.ilike.%${s}%,address.ilike.%${s}%,category.ilike.%${s}%`
        );
      }
    }
    query = query
      .order(q.sortCol, { ascending: q.sortDir === "asc", nullsFirst: false })
      .range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);

    const { data, error, count } = await query;
    if (!error && data) {
      return {
        leads: (data as LeadRow[]).map(rowToLead),
        total: count ?? data.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    }
    if (error) console.error("Supabase queryLeads failed:", error.message);
  }

  // ── Fallback: full fetch (CSV/local/GitHub), filter/sort/paginate in memory ──
  const all = await fetchLeads();
  const filtered = all.filter((l) => matchesQueryInMemory(l, q));
  const sorted = sortLeadsInMemory(filtered, q);
  const start = (q.page - 1) * q.pageSize;
  return {
    leads: sorted.slice(start, start + q.pageSize),
    total: filtered.length,
    page: q.page,
    pageSize: q.pageSize,
  };
}

// Same filter set as queryLeads, but returns every matching lead (no page
// cap) — used by the CSV export route, which needs the whole filtered set
// rather than just the currently-displayed page.
export async function queryAllLeads(rawQuery: Omit<LeadsQuery, "page" | "pageSize">): Promise<Lead[]> {
  const q = normalizeQuery(rawQuery);

  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const rows: LeadRow[] = [];
    let failed = false;
    for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
      let query = supabase.from("leads").select(LEAD_SELECT_COLUMNS);
      if (q.tier) query = query.eq("tier", q.tier);
      if (q.source) query = query.eq("source", q.source);
      if (q.industry) query = query.eq("industry", q.industry);
      if (q.tag) query = query.contains("tags", [q.tag]);
      if (q.region) query = query.eq("region", q.region);
      if (q.firmSizeBand) query = query.eq("firm_size_band", q.firmSizeBand);
      if (q.minScore != null) query = query.gte("score", q.minScore);
      if (q.maxScore != null) query = query.lte("score", q.maxScore);
      if (q.hasEmail) query = query.not("email", "is", null).neq("email", "");
      if (q.search) {
        const s = q.search.trim().replace(/[%_,]/g, "\\$&");
        if (s) {
          query = query.or(
            `company_name.ilike.%${s}%,email.ilike.%${s}%,address.ilike.%${s}%,category.ilike.%${s}%`
          );
        }
      }
      query = query
        .order(q.sortCol, { ascending: q.sortDir === "asc", nullsFirst: false })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) {
        console.error("Supabase queryAllLeads failed:", error.message);
        failed = true;
        break;
      }
      const page = data as LeadRow[];
      rows.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
    }
    if (!failed) return rows.map(rowToLead);
  }

  const all = await fetchLeads();
  return sortLeadsInMemory(
    all.filter((l) => matchesQueryInMemory(l, q)),
    q
  );
}

export type LeadFacets = {
  sources: string[];
};

// Distinct filter option lists the UI needs (source is dynamic/data-driven;
// industry/region/firmSizeBand come from the static shared taxonomy/regions
// files instead — see free-nextjs-admin-dashboard-main/src/lib/facets.ts).
export async function fetchLeadFacets(): Promise<LeadFacets> {
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase.from("leads").select("source").not("source", "is", null);
    if (!error && data) {
      const rows = data as unknown as { source: string }[];
      const sources = Array.from(new Set(rows.map((r) => r.source))).sort();
      return { sources };
    }
  }
  const all = await fetchLeads();
  const sources = Array.from(new Set(all.map((l) => l.source).filter(Boolean))).sort();
  return { sources };
}
