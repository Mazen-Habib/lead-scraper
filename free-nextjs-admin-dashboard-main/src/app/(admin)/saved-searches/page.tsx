import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import SavedSearchesList, { type SavedSearch } from "@/components/saved-searches/SavedSearchesList";

export const metadata: Metadata = {
  title: "Lead Portal — Saved Searches",
  description: "Revisit your saved lead filters",
};

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  const supabase = await getSupabaseServerClient();
  let savedSearches: SavedSearch[] = [];

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("saved_searches")
        .select("id, name, filter_json, is_active, created_at")
        .order("created_at", { ascending: false });
      savedSearches = (data as SavedSearch[] | null) ?? [];
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Saved Searches</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Filters you&apos;ve saved from the Leads page — apply, rename, or delete them here.
        </p>
      </div>
      <SavedSearchesList initialSavedSearches={savedSearches} />
    </div>
  );
}
