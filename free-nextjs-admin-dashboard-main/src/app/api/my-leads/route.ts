import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, getSupabaseServerClient } from "@/lib/supabase/server";
import { LEAD_SELECT_COLUMNS, rowToLead, type LeadRow } from "@/lib/leads";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type UserLeadRow = {
  id: number;
  saved_search_id: number | null;
  delivery_reason: string;
  first_delivered_at: string;
  leads: LeadRow | null;
};

// Leads delivered to the signed-in user, newest first. `delivery_reason`
// travels with each row so the UI can badge 'fresh' (a scrape run actually
// discovered this) apart from 'backfill' (it already existed in the corpus and
// is merely new to this user). RLS scopes rows to the owner.
export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const userId = await getCurrentUserId(supabase);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const savedSearchId = parseInt(params.get("savedSearchId") || "", 10);
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);

  let query = supabase
    .from("user_leads")
    .select(`id, saved_search_id, delivery_reason, first_delivered_at, leads (${LEAD_SELECT_COLUMNS})`, {
      count: "exact",
    })
    // See the note in api/saved-searches/route.ts: service-role bypasses RLS,
    // so ownership is filtered explicitly rather than assumed.
    .eq("user_id", userId)
    .order("first_delivered_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (Number.isFinite(savedSearchId)) query = query.eq("saved_search_id", savedSearchId);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data as unknown as UserLeadRow[]) ?? [];
  const items = rows
    .filter((r) => r.leads)
    .map((r) => ({
      ...rowToLead(r.leads as LeadRow),
      delivery_reason: r.delivery_reason,
      first_delivered_at: r.first_delivered_at,
      saved_search_id: r.saved_search_id,
    }));

  return NextResponse.json({ leads: items, total: count ?? items.length, page, pageSize: PAGE_SIZE });
}
