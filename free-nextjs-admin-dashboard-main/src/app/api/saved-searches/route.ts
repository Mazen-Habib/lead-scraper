import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSavedSearchSchema } from "@/lib/validation/savedSearch";
import { queryLeads, type LeadsQuery } from "@/lib/leads";

export const dynamic = "force-dynamic";

// How many pre-existing corpus leads a brand-new saved search is seeded with.
const BACKFILL_LIMIT = 200;

export async function GET() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("saved_searches")
    .select("id, name, filter_json, schedule, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ savedSearches: data });
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSavedSearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("saved_searches")
    .insert({ user_id: user.id, name: parsed.data.name, filter_json: parsed.data.filter_json })
    .select("id, name, filter_json, schedule, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const backfilled = await backfillExistingMatches(supabase, user.id, data.id, parsed.data.filter_json);
  return NextResponse.json({ savedSearch: data, backfilled }, { status: 201 });
}

/**
 * Seeds a new saved search with leads already in the corpus that match it.
 *
 * These are genuinely new *to this user*, so they're worth delivering
 * immediately rather than making them wait for the first scrape — but they are
 * tagged delivery_reason='backfill' so the UI can badge them as coming from the
 * existing corpus. Only leads a scrape run actually discovers are ever labelled
 * 'fresh'.
 *
 * Best-effort: a failure here must not fail the save itself.
 */
async function backfillExistingMatches(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>,
  userId: string,
  savedSearchId: number,
  filter: LeadsQuery
): Promise<number> {
  try {
    const { leads } = await queryLeads({ ...filter, page: 1, pageSize: BACKFILL_LIMIT });
    const rows = leads
      .filter((lead) => lead.id != null)
      .map((lead) => ({
        user_id: userId,
        lead_id: lead.id as number,
        saved_search_id: savedSearchId,
        delivery_reason: "backfill",
      }));
    if (rows.length === 0) return 0;

    // unique(user_id, lead_id) means a lead already delivered via another saved
    // search is left alone rather than duplicated.
    const { data, error } = await supabase
      .from("user_leads")
      .upsert(rows, { onConflict: "user_id,lead_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("Saved-search backfill failed:", error.message);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.error("Saved-search backfill threw:", err);
    return 0;
  }
}
