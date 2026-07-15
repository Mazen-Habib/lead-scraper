import type { Lead } from "./lead-types";
import { getSupabaseClient } from "./supabaseClient";
export type { Lead } from "./lead-types";
export { SOURCE_LABELS } from "./lead-types";

type LeadRow = {
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
};

// DB columns are properly typed (numeric/int); the rest of the app expects
// the CSV-era string shape, so normalize here rather than touching every consumer.
function rowToLead(row: LeadRow): Lead {
  return {
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
    return obj as Lead;
  });
}

const SUPABASE_PAGE_SIZE = 1000; // PostgREST's default/max row cap per request

async function fetchAllLeadRows(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>
): Promise<LeadRow[] | null> {
  const rows: LeadRow[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(
        "company_name, category, website, email, all_emails, phone, address, linkedin, facebook, instagram, rating, review_count, company_size, hourly_rate, min_project, search_query, profile_url, source, engine, email_verified, score, tier, scraped_at"
      )
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
  // ── Primary: Supabase (populated by the nightly scraper's upsert) ───────────
  const supabase = getSupabaseClient();
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
