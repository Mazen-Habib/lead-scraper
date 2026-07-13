import type { Metadata } from "next";
import { fetchLeads, SOURCE_LABELS } from "@/lib/leads";
import TierDonutChart from "@/components/leads/TierDonutChart";
import SourceBarChart from "@/components/leads/SourceBarChart";
import ScoreHistogram from "@/components/leads/ScoreHistogram";

export const metadata: Metadata = {
  title: "Lead Portal — Dashboard",
  description: "Live lead generation dashboard",
};

const TIER_CONFIG = {
  A: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", bar: "bg-green-500" },
  B: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", bar: "bg-blue-500" },
  C: { color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", bar: "bg-yellow-400" },
  D: { color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", bar: "bg-gray-400" },
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

  // ── Computed stats ──────────────────────────────────────────────────────────
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

  // Source breakdown
  const sourceCounts: Record<string, number> = {};
  for (const lead of leads) {
    const src = lead.source || "unknown";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Score histogram — 10 buckets of 10
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  for (const lead of leads) {
    const s = parseInt(lead.score) || 0;
    const idx = Math.min(9, Math.floor(s / 10));
    buckets[idx].count++;
  }

  // Last run date
  const lastRun = leads.reduce<string | null>(
    (latest, l) => (!latest || (l.scraped_at && l.scraped_at > latest) ? l.scraped_at : latest),
    null
  );
  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "No runs yet";

  const topLeads = leads.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Lead Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Last scraper run: {lastRunLabel}</p>
        </div>
        <a
          href="/leads"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          View All Leads →
        </a>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Leads", value: total.toLocaleString(), sub: "in master CSV", icon: "📊", color: "text-brand-500" },
          { label: "Tier A", value: tierA.toLocaleString(), sub: `${total > 0 ? Math.round((tierA / total) * 100) : 0}% top-quality`, icon: "🏆", color: "text-green-500" },
          { label: "Have Email", value: withEmail.toLocaleString(), sub: `${total > 0 ? Math.round((withEmail / total) * 100) : 0}% contactable`, icon: "📧", color: "text-blue-500" },
          { label: "Avg Score", value: `${avgScore}/100`, sub: "composite quality", icon: "⭐", color: "text-yellow-500" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <div className="text-2xl mb-3">{card.icon}</div>
            <div className={`text-3xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">{card.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Secondary stats ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "With Phone", value: withPhone, icon: "📞" },
          { label: "With LinkedIn", value: withLinkedin, icon: "💼" },
          { label: "Tier A + B", value: tierA + tierB, icon: "🎯" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-white/[0.03] flex items-center gap-4"
          >
            <span className="text-2xl">{s.icon}</span>
            <div>
              <div className="text-xl font-bold text-gray-800 dark:text-white">{s.value.toLocaleString()}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TierDonutChart counts={{ A: tierA, B: tierB, C: tierC, D: tierD }} />
        <ScoreHistogram buckets={buckets} />
      </div>

      {/* ── Source bar chart (full width) ── */}
      <SourceBarChart sources={topSources} />

      {/* ── Top leads table ── */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white">Top Leads by Score</h3>
          <a href="/leads" className="text-sm text-brand-500 hover:text-brand-600 font-medium">View all →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
                {["Company", "Email", "Phone", "Location", "Source", "Score", "Tier"].map((h) => (
                  <th key={h} className="px-5 py-3 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {topLeads.map((lead, i) => {
                const tier = lead.tier as keyof typeof TIER_CONFIG;
                const tierCfg = TIER_CONFIG[tier] ?? TIER_CONFIG.D;
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 max-w-[180px]">
                      <div className="font-medium text-gray-800 dark:text-white truncate">
                        {lead.website ? (
                          <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">
                            {lead.company_name || "—"}
                          </a>
                        ) : (lead.company_name || "—")}
                      </div>
                      <div className="text-xs text-gray-400 truncate">{lead.category}</div>
                    </td>
                    <td className="px-5 py-3 max-w-[160px]">
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="text-gray-600 dark:text-gray-300 hover:text-brand-500 truncate block text-xs">
                          {lead.email}
                        </a>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300 text-xs whitespace-nowrap">
                      {lead.phone || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[140px] truncate text-xs">
                      {lead.address || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300 text-xs whitespace-nowrap">
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </td>
                    <td className="px-5 py-3 font-bold text-gray-800 dark:text-white">
                      {lead.score || "—"}
                    </td>
                    <td className="px-5 py-3">
                      {tier ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tierCfg.color}`}>{tier}</span>
                      ) : "—"}
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
