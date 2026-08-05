import type { Metadata } from "next";
import MyLeadsTable from "@/components/leads/MyLeadsTable";

export const metadata: Metadata = {
  title: "Lead Portal — My Leads",
  description: "Leads delivered to you from your saved searches",
};

export const dynamic = "force-dynamic";

export default async function MyLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ savedSearchId?: string }>;
}) {
  const { savedSearchId } = await searchParams;
  const parsed = savedSearchId ? parseInt(savedSearchId, 10) : NaN;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">My Leads</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Leads delivered to you from your saved searches. <span className="font-medium">Fresh</span> means a scrape
          run discovered it for you; <span className="font-medium">From corpus</span> means it already existed in the
          database and is new to you.
        </p>
      </div>
      <MyLeadsTable savedSearchId={Number.isFinite(parsed) ? parsed : undefined} />
    </div>
  );
}
