import type { Metadata } from "next";
import { queryLeads, fetchLeadFacets } from "@/lib/leads";
import LeadsTable from "@/components/leads/LeadsTable";

export const metadata: Metadata = {
  title: "Lead Portal — Leads",
  description: "Browse, filter, and export all scraped leads",
};

// Leads change weekly via the scraper's cron; never statically cache this page.
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [initial, facets] = await Promise.all([
    queryLeads({ page: 1, pageSize: 50 }),
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
      />
    </div>
  );
}
