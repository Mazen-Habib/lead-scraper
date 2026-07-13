import type { Metadata } from "next";
import { fetchLeads } from "@/lib/leads";
import LeadsTable from "@/components/leads/LeadsTable";

export const metadata: Metadata = {
  title: "Lead Portal — Leads",
  description: "Browse, filter, and export all scraped leads",
};

export default async function LeadsPage() {
  const leads = await fetchLeads();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">All Leads</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {leads.length.toLocaleString()} total leads · sorted by score descending · refreshed hourly
        </p>
      </div>
      <LeadsTable leads={leads} />
    </div>
  );
}
