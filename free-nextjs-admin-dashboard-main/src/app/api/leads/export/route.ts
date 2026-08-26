import { NextRequest, NextResponse } from "next/server";
import { queryAllLeads, type Lead, type LeadsQuery } from "@/lib/leads";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "company_name", "category", "email", "phone", "address", "website",
  "linkedin", "source", "score", "tier", "rating", "review_count",
  "company_size", "hourly_rate", "email_verified", "industry", "region",
  "country", "city", "contact_name", "contact_title",
  "firm_size_band", "tags", "scraped_at",
] as (keyof Lead)[];

function esc(raw: string | number | boolean | string[] | null | undefined): string {
  const v = Array.isArray(raw) ? raw.join("; ") : String(raw ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCSV(leads: Lead[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = leads.map((l) => CSV_COLUMNS.map((c) => esc(l[c])).join(","));
  return [header, ...rows].join("\r\n");
}

// GET /api/leads/export?<same filters as /api/leads> — streams every
// matching lead as CSV (no pagination cap), so "export" always reflects the
// full filtered set even though the table only ever holds one page client-side.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query: LeadsQuery = {
    tier: params.get("tier") || undefined,
    source: params.get("source") || undefined,
    industry: params.get("industry") || undefined,
    tag: params.get("tag") || undefined,
    region: params.get("region") || undefined,
    country: params.get("country") || undefined,
    city: params.get("city") || undefined,
    firmSizeBand: params.get("firmSizeBand") || undefined,
    minScore: params.get("minScore") ? parseInt(params.get("minScore")!, 10) : undefined,
    maxScore: params.get("maxScore") ? parseInt(params.get("maxScore")!, 10) : undefined,
    hasEmail: params.get("hasEmail") === "1" || params.get("hasEmail") === "true",
    search: params.get("search") || undefined,
    sortCol: params.get("sortCol") === "scraped_at" ? "scraped_at" : "score",
    sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
  };

  const leads = await queryAllLeads(query);
  return new NextResponse(toCSV(leads), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="leads.csv"',
    },
  });
}
