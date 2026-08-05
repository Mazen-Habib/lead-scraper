import { NextResponse } from "next/server";
import { fetchLeadFacets } from "@/lib/leads";

export const dynamic = "force-dynamic";

// GET /api/leads/facets — dynamic filter option lists (distinct sources)
// that can't be hardcoded like industry/region since new sources get added
// to the scraper config over time (config.json). Industry/region option
// lists are static (@/lib/facets) since they mirror the shared taxonomy.
export async function GET() {
  const facets = await fetchLeadFacets();
  return NextResponse.json(facets);
}
