import type { Metadata } from "next";
import Link from "next/link";
import { fetchLeads, SOURCE_LABELS } from "@/lib/leads";
import TierDonutChart from "@/components/leads/TierDonutChart";
import SourceBarChart from "@/components/leads/SourceBarChart";
import ScoreHistogram from "@/components/leads/ScoreHistogram";

export const metadata: Metadata = {
  title: "Lead Portal — Dashboard",
  description: "Live lead generation dashboard",
};

const TIER_BADGE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  D: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default async function DashboardPage() {
  const leads = await fetchLeads();

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="text-5xl">📋</div>
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">No leads yet</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md text-sm leading-relaxed">
          Set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_OWNER</code>,{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_REPO</code>, and{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_TOKEN</code> in{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">.env.local</code>, then
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
    const idx = Math.min(9, Math.floor(s / 10));
    buckets[idx].count++;
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
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Lead Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Last scraper run: {lastRunLabel}
          </p>
        </div>
        <Link
          href="/leads"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors shadow-sm"
        >
          View All Leads <span aria-hidden>→</span>
        </Link>
      </div>

      {/* ── Primary KPI cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total Leads */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-5 group hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 to-brand-600 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center text-xl">
              📊
            </div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total</span>
          </div>
          <div className="text-4xl font-black text-gray-900 dark:text-white tabular-nums">
            {total.toLocaleString()}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">Total Leads</div>
          <div className="mt-1 text-xs text-gray-400">across all sources</div>
        </div>

        {/* Tier A */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-5 hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-xl">
              🏆
            </div>
            <span className="text-xs font-medium text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
              {tierAPct}%
            </span>
          </div>
          <div className="text-4xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
            {tierA.toLocaleString()}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">Tier A Leads</div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${tierAPct}%` }} />
          </div>
        </div>

        {/* Have Email */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-5 hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-400 to-blue-600 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-xl">
              📧
            </div>
            <span className="text-xs font-medium text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
              {emailPct}%
            </span>
          </div>
          <div className="text-4xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
            {withEmail.toLocaleString()}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">Have Email</div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${emailPct}%` }} />
          </div>
        </div>

        {/* Avg Score */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] p-5 hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 to-orange-500 rounded-t-2xl" />
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-xl">
              ⭐
            </div>
            <span className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
              / 100
            </span>
          </div>
          <div className="text-4xl font-black text-amber-600 dark:text-amber-400 tabular-nums">
            {avgScore || "—"}
          </div>
          <div className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">Avg Score</div>
          {avgScore > 0 ? (
            <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-1.5 rounded-full bg-amber-500 transition-all" style={{ width: `${avgScore}%` }} />
            </div>
          ) : (
            <div className="mt-2 text-xs text-gray-400">Pending next run</div>
          )}
        </div>
      </div>

      {/* ── Secondary stats row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "With Phone", value: withPhone, icon: "📞", pct: total > 0 ? Math.round((withPhone / total) * 100) : 0, color: "text-violet-500" },
          { label: "With LinkedIn", value: withLinkedin, icon: "💼", pct: total > 0 ? Math.round((withLinkedin / total) * 100) : 0, color: "text-sky-500" },
          { label: "Tier A + B", value: tierA + tierB, icon: "🎯", pct: total > 0 ? Math.round(((tierA + tierB) / total) * 100) : 0, color: "text-emerald-500" },
          { label: "Sources", value: Object.keys(sourceCounts).length, icon: "🗂️", pct: null, color: "text-orange-500" },
        ].map((s) => (
          <div key={s.label}
            className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] px-4 py-4 flex items-center gap-3">
            <div className="text-2xl">{s.icon}</div>
            <div className="min-w-0">
              <div className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {s.label}{s.pct !== null ? ` · ${s.pct}%` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TierDonutChart counts={{ A: tierA, B: tierB, C: tierC, D: tierD }} />
        <ScoreHistogram buckets={buckets} />
      </div>

      {/* ── Source bar (full width) ─────────────────────────────────────────── */}
      <SourceBarChart sources={topSources} />

      {/* ── Top leads table ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white">Top Leads by Score</h3>
            <p className="text-xs text-gray-400 mt-0.5">Click a lead on the Leads page for full details</p>
          </div>
          <Link href="/leads" className="text-sm text-brand-500 hover:text-brand-600 font-semibold">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.01] text-left">
                {["#", "Company", "Email", "Phone", "Source", "Score", "Tier"].map((h) => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {topLeads.map((lead, i) => {
                const tier = lead.tier as keyof typeof TIER_BADGE;
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-5 py-3 max-w-[180px]">
                      <div className="font-semibold text-gray-800 dark:text-white truncate">
                        {lead.website ? (
                          <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">
                            {lead.company_name || "—"}
                          </a>
                        ) : (lead.company_name || "—")}
                      </div>
                      {lead.category && (
                        <div className="text-xs text-gray-400 truncate">{lead.category}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 max-w-[160px]">
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="text-xs text-gray-600 dark:text-gray-300 hover:text-brand-500 truncate block">
                          {lead.email}
                        </a>
                      ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {lead.phone || "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </td>
                    <td className="px-5 py-3 font-bold text-gray-800 dark:text-white">
                      {lead.score || <span className="text-gray-300 dark:text-gray-600 text-xs font-normal">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {tier ? (
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${TIER_BADGE[tier] ?? TIER_BADGE.D}`}>{tier}</span>
                      ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
