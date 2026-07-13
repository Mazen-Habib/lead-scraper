import { NextResponse } from "next/server";
import { fetchLeads } from "@/lib/leads";

export async function GET() {
  const leads = await fetchLeads();
  return NextResponse.json(leads);
}
