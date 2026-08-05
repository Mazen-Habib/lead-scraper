import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Queues a real scrape for a saved search and asks GitHub Actions to run the
// worker (`node src/index.js saved-searches`).
//
// The scrape_runs row is the single source of truth for status — the UI polls
// it rather than optimistically claiming success. If the workflow can't be
// triggered, the run is marked failed with the reason instead of sitting
// "pending" forever and looking like work is happening when nothing is.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const savedSearchId = parseInt(id, 10);
  if (!Number.isFinite(savedSearchId)) {
    return NextResponse.json({ error: "Invalid saved search id" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS scopes this to the owner, so a missing row means "not yours or gone".
  const { data: search } = await supabase
    .from("saved_searches")
    .select("id, depth")
    .eq("id", savedSearchId)
    .single();
  if (!search) return NextResponse.json({ error: "Saved search not found" }, { status: 404 });

  // One in-flight run per saved search — stops repeated clicks from queueing
  // duplicate scrapes of the same thing.
  const { data: inFlight } = await supabase
    .from("scrape_runs")
    .select("id, status")
    .eq("saved_search_id", savedSearchId)
    .in("status", ["pending", "running"])
    .limit(1);
  if (inFlight && inFlight.length > 0) {
    return NextResponse.json(
      { error: "A run is already in progress for this search.", run: inFlight[0] },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const depth = body?.depth === "deep" ? "deep" : "quick";
  if (depth !== search.depth) {
    await supabase.from("saved_searches").update({ depth }).eq("id", savedSearchId);
  }

  const { data: run, error } = await supabase
    .from("scrape_runs")
    .insert({
      user_id: user.id,
      saved_search_id: savedSearchId,
      trigger: "manual",
      status: "pending",
    })
    .select("id, status, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dispatch = await triggerWorkflow();
  if (!dispatch.ok) {
    await supabase
      .from("scrape_runs")
      .update({
        status: "failed",
        error: `Could not start the scrape worker: ${dispatch.reason}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    return NextResponse.json(
      { error: `Queued but could not start the worker: ${dispatch.reason}`, run },
      { status: 502 }
    );
  }

  return NextResponse.json({ run }, { status: 202 });
}

async function triggerWorkflow(): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const workflow = process.env.GITHUB_WORKFLOW_FILE || "personalized-scrape.yml";
  const ref = process.env.GITHUB_WORKFLOW_REF || "main";

  if (!token || !owner || !repo) {
    return {
      ok: false,
      reason: "GITHUB_DISPATCH_TOKEN / GITHUB_OWNER / GITHUB_REPO are not configured",
    };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref }),
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, reason: `GitHub responded ${res.status} ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "network error" };
  }
}
