import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function GET() {
  const leads = await fetchLeads();
  return NextResponse.json(leads);
}
