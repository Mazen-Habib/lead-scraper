import { NextRequest, NextResponse } from "next/server";
import { queryLeads, type LeadsQuery } from "@/lib/leads";

export const dynamic = "force-dynamic";

function parseIntParam(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

// GET /api/leads?tier=A&source=clutch&industry=ai-ml&tag=cloud-devops&region=middle-east
//   &firmSizeBand=mid&minScore=50&maxScore=100&hasEmail=1&search=acme
//   &page=1&pageSize=50&sortCol=score&sortDir=desc
// Every filter is a plain query param the backend turns into a WHERE clause
// (roadmap Phase 4.1) — omit a param to leave that dimension unfiltered.
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
    leadType: params.get("leadType") || undefined,
    firmSizeBand: params.get("firmSizeBand") || undefined,
    minScore: parseIntParam(params.get("minScore")),
    maxScore: parseIntParam(params.get("maxScore")),
    hasEmail: params.get("hasEmail") === "1" || params.get("hasEmail") === "true",
    search: params.get("search") || undefined,
    page: parseIntParam(params.get("page")),
    pageSize: parseIntParam(params.get("pageSize")),
    sortCol: params.get("sortCol") === "scraped_at" ? "scraped_at" : "score",
    sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
  };

  const result = await queryLeads(query);
  return NextResponse.json(result);
}
