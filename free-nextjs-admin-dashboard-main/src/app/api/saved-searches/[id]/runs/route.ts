import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Run history for one saved search. This is what the dashboard polls for status —
// every pill it renders (Queued / Running / Done / Failed), the lead count, and
// any error text comes from these rows, so the UI can never claim a run
// succeeded when it didn't.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const savedSearchId = parseInt(id, 10);
  if (!Number.isFinite(savedSearchId)) {
    return NextResponse.json({ error: "Invalid saved search id" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const userId = await getCurrentUserId(supabase);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.min(20, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") || "5", 10) || 5));

  // RLS restricts scrape_runs to the owner.
  const { data, error } = await supabase
    .from("scrape_runs")
    .select("id, status, trigger, started_at, finished_at, leads_found, error, created_at")
    .eq("saved_search_id", savedSearchId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
