import type { Metadata } from "next";
import { queryLeads, fetchLeadFacets } from "@/lib/leads";
import LeadsTable from "@/components/leads/LeadsTable";

export const metadata: Metadata = {
  title: "Lead Portal — Leads",
  description: "Browse, filter, and export all scraped leads",
};

// Leads change weekly via the scraper's cron; never statically cache this page.
export const dynamic = "force-dynamic";

function parseIntParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const initialQuery = {
    tier: get("tier"),
    source: get("source"),
    industry: get("industry"),
    tag: get("tag"),
    region: get("region"),
    firmSizeBand: get("firmSizeBand"),
    minScore: parseIntParam(get("minScore")),
    maxScore: parseIntParam(get("maxScore")),
    hasEmail: get("hasEmail") === "1" || get("hasEmail") === "true",
    search: get("search"),
    sortCol: get("sortCol") === "scraped_at" ? ("scraped_at" as const) : ("score" as const),
    sortDir: get("sortDir") === "asc" ? ("asc" as const) : ("desc" as const),
  };

  const [initial, facets] = await Promise.all([
    queryLeads({ ...initialQuery, page: 1, pageSize: 50 }),
    fetchLeadFacets(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">All Leads</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {initial.total.toLocaleString()} total leads · sorted by score descending · live from Supabase
        </p>
      </div>
      <LeadsTable
        initialLeads={initial.leads}
        initialTotal={initial.total}
        sources={facets.sources}
        initialQuery={initialQuery}
      />
    </div>
  );
}
