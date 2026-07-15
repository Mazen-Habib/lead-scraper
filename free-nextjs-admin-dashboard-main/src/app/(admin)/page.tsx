import type { Metadata } from "next";
import Link from "next/link";
import { fetchLeads, SOURCE_LABELS } from "@/lib/leads";
import TierDonutChart from "@/components/leads/TierDonutChart";
import SourceBarChart from "@/components/leads/SourceBarChart";
import ScoreHistogram from "@/components/leads/ScoreHistogram";
import Badge from "@/components/ui/badge/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Lead Portal — Dashboard",
  description: "Live lead generation dashboard",
};

// Leads change nightly via the scraper's cron; never statically cache this page.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const leads = await fetchLeads();

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">No leads yet</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md text-sm leading-relaxed">
          Set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          in <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">.env.local</code>, then
          trigger the nightly scraper workflow on GitHub Actions.
        </p>
      </div>
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total = leads.length;
  const tierA = leads.filter((l) => l.tier === "A").length;
  const tierB = leads.filter((l) => l.tier === "B").length;
  const tierC = leads.filter((l) => l.tier === "C").length;
  const tierD = leads.filter((l) => l.tier === "D").length;
  const withEmail = leads.filter((l) => l.email).length;
  const withPhone = leads.filter((l) => l.phone).length;
  const withLinkedin = leads.filter((l) => l.linkedin).length;
  const avgScore =
    total > 0
      ? Math.round(leads.reduce((s, l) => s + (parseInt(l.score) || 0), 0) / total)
      : 0;

  const emailPct = total > 0 ? Math.round((withEmail / total) * 100) : 0;
  const tierAPct = total > 0 ? Math.round((tierA / total) * 100) : 0;
  const phonePct = total > 0 ? Math.round((withPhone / total) * 100) : 0;
  const linkedinPct = total > 0 ? Math.round((withLinkedin / total) * 100) : 0;

  const sourceCounts: Record<string, number> = {};
  for (const lead of leads) {
    const src = lead.source || "unknown";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  for (const lead of leads) {
    const s = parseInt(lead.score) || 0;
    buckets[Math.min(9, Math.floor(s / 10))].count++;
  }

  const lastRun = leads.reduce<string | null>(
    (latest, l) => (!latest || (l.scraped_at && l.scraped_at > latest) ? l.scraped_at : latest),
    null
  );
  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "No runs yet";

  const topLeads = [...leads]
    .sort((a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0))
    .slice(0, 10);

  return (
    <div className="space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">
            Lead Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Last scraper run: {lastRunLabel}
          </p>
        </div>
        <Link
          href="/leads"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 transition-colors"
        >
          View All Leads
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>

      {/* ── Primary KPI cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">

        {/* Total Leads */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <svg className="text-gray-800 dark:text-white/90 w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Total Leads</span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {total.toLocaleString()}
              </h4>
            </div>
            <Badge color="primary" size="sm">{topSources.length} sources</Badge>
          </div>
        </div>

        {/* Tier A */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <svg className="text-gray-800 dark:text-white/90 w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Tier A Leads</span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {tierA.toLocaleString()}
              </h4>
            </div>
            <Badge color="success" size="sm">{tierAPct}% of total</Badge>
          </div>
        </div>

        {/* Have Email */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <svg className="text-gray-800 dark:text-white/90 w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Have Email</span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {withEmail.toLocaleString()}
              </h4>
            </div>
            <Badge color="info" size="sm">{emailPct}% contactable</Badge>
          </div>
        </div>

        {/* Avg Score */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <svg className="text-gray-800 dark:text-white/90 w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Avg Score</span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {avgScore > 0 ? `${avgScore}/100` : "—"}
              </h4>
            </div>
            {avgScore > 0 ? (
              <Badge color={avgScore >= 75 ? "success" : avgScore >= 55 ? "primary" : "warning"} size="sm">
                {avgScore >= 75 ? "Excellent" : avgScore >= 55 ? "Good" : "Fair"}
              </Badge>
            ) : (
              <Badge color="light" size="sm">Pending</Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Secondary stats ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-xl dark:bg-gray-800 shrink-0">
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">With Phone</p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90 mt-0.5">
                {withPhone.toLocaleString()} <span className="text-sm font-normal text-gray-400">({phonePct}%)</span>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-xl dark:bg-gray-800 shrink-0">
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">With LinkedIn</p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90 mt-0.5">
                {withLinkedin.toLocaleString()} <span className="text-sm font-normal text-gray-400">({linkedinPct}%)</span>
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-xl dark:bg-gray-800 shrink-0">
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Tier A + B</p>
              <p className="text-xl font-bold text-gray-800 dark:text-white/90 mt-0.5">
                {(tierA + tierB).toLocaleString()} <span className="text-sm font-normal text-gray-400">({total > 0 ? Math.round(((tierA + tierB) / total) * 100) : 0}%)</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TierDonutChart counts={{ A: tierA, B: tierB, C: tierC, D: tierD }} />
        <ScoreHistogram buckets={buckets} />
      </div>

      {/* ── Source bar ───────────────────────────────────────────────────────── */}
      <SourceBarChart sources={topSources} />

      {/* ── Top leads table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
        <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Top Leads by Score
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Highest-scoring leads from all sources
            </p>
          </div>
          <Link
            href="/leads"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03]"
          >
            See all
          </Link>
        </div>
        <div className="max-w-full overflow-x-auto">
          <Table>
            <TableHeader className="border-gray-100 dark:border-gray-800 border-y">
              <TableRow>
                {["Company", "Email", "Phone", "Source", "Score", "Tier"].map((h) => (
                  <TableCell key={h} isHeader
                    className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {topLeads.map((lead, i) => (
                <TableRow key={i}>
                  <TableCell className="py-3">
                    <p className="font-medium text-gray-800 text-theme-sm dark:text-white/90 truncate max-w-[180px]">
                      {lead.website ? (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer"
                          className="hover:text-brand-500 transition-colors">
                          {lead.company_name || "—"}
                        </a>
                      ) : (lead.company_name || "—")}
                    </p>
                    {lead.category && (
                      <span className="text-gray-500 text-theme-xs dark:text-gray-400 truncate block max-w-[180px]">
                        {lead.category}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400 max-w-[160px]">
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="hover:text-brand-500 truncate block">
                        {lead.email}
                      </a>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400 whitespace-nowrap">
                    {lead.phone || "—"}
                  </TableCell>
                  <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400 whitespace-nowrap">
                    {SOURCE_LABELS[lead.source] ?? lead.source}
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="font-semibold text-gray-800 dark:text-white/90 text-theme-sm">
                      {lead.score || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    {lead.tier ? (
                      <Badge
                        size="sm"
                        color={
                          lead.tier === "A" ? "success" :
                          lead.tier === "B" ? "primary" :
                          lead.tier === "C" ? "warning" : "light"
                        }
                      >
                        {lead.tier}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
