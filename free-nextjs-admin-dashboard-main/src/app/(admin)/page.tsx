import type { Metadata } from "next";
import { fetchLeads, SOURCE_LABELS } from "@/lib/leads";

export const metadata: Metadata = {
  title: "Lead Portal — Dashboard",
  description: "Live lead generation dashboard",
};

const TIER_CONFIG = {
  A: { label: "Tier A", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", bar: "bg-green-500", desc: "Top — reach out immediately" },
  B: { label: "Tier B", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", bar: "bg-blue-500", desc: "Strong — worth pursuing" },
  C: { label: "Tier C", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", bar: "bg-yellow-400", desc: "Qualified — nurture further" },
  D: { label: "Tier D", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", bar: "bg-gray-400", desc: "Weak — low data confidence" },
};

export default async function DashboardPage() {
  const leads = await fetchLeads();

  const total = leads.length;
  const tierA = leads.filter((l) => l.tier === "A").length;
  const tierB = leads.filter((l) => l.tier === "B").length;
  const tierC = leads.filter((l) => l.tier === "C").length;
  const tierD = leads.filter((l) => l.tier === "D").length;
  const withEmail = leads.filter((l) => l.email).length;
  const avgScore =
    total > 0
      ? Math.round(leads.reduce((s, l) => s + (parseInt(l.score) || 0), 0) / total)
      : 0;

  const sourceCounts: Record<string, number> = {};
  for (const lead of leads) {
    const src = lead.source || "unknown";
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const topLeads = leads.slice(0, 10);

  const lastRun = leads.reduce<string | null>((latest, l) => {
    if (!l.scraped_at) return latest;
    return !latest || l.scraped_at > latest ? l.scraped_at : latest;
  }, null);
  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "No runs yet";

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="text-5xl">📋</div>
        <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">No leads yet</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          Set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_OWNER</code>,{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_REPO</code>, and optionally{" "}
          <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">GITHUB_TOKEN</code> environment variables,
          then trigger the nightly scraper workflow on GitHub Actions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Lead Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Last scraper run: {lastRunLabel}</p>
        </div>
        <a
          href="/leads"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          View All Leads →
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Leads", value: total.toLocaleString(), sub: "in master CSV", icon: "📊" },
          { label: "Tier A Leads", value: tierA.toLocaleString(), sub: `${total > 0 ? Math.round((tierA / total) * 100) : 0}% of total`, icon: "🏆" },
          { label: "Have Email", value: withEmail.toLocaleString(), sub: `${total > 0 ? Math.round((withEmail / total) * 100) : 0}% contactable`, icon: "📧" },
          { label: "Avg Score", value: `${avgScore}/100`, sub: "composite quality", icon: "⭐" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <div className="text-2xl mb-2">{card.icon}</div>
            <div className="text-2xl font-bold text-gray-800 dark:text-white">{card.value}</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">{card.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Tier Breakdown + Source Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tier Breakdown */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-4">Lead Tier Breakdown</h3>
          <div className="space-y-3">
            {(["A", "B", "C", "D"] as const).map((t) => {
              const count = { A: tierA, B: tierB, C: tierC, D: tierD }[t];
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              const cfg = TIER_CONFIG[t];
              return (
                <div key={t}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{cfg.desc}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {count.toLocaleString()} <span className="text-gray-400">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className={`h-2 rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Source Breakdown */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-4">Leads by Source</h3>
          <div className="space-y-3">
            {topSources.map(([src, count]) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={src}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{SOURCE_LABELS[src] ?? src}</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {count.toLocaleString()} <span className="text-gray-400">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Leads Preview */}
      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white">Top Leads by Score</h3>
          <a href="/leads" className="text-sm text-brand-500 hover:text-brand-600 font-medium">View all →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Location</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {topLeads.map((lead, i) => {
                const tier = lead.tier as keyof typeof TIER_CONFIG;
                const tierCfg = TIER_CONFIG[tier] ?? TIER_CONFIG.D;
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800 dark:text-white">
                        {lead.website ? (
                          <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">
                            {lead.company_name || "—"}
                          </a>
                        ) : (
                          lead.company_name || "—"
                        )}
                      </div>
                      <div className="text-xs text-gray-400 truncate max-w-[180px]">{lead.category}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300">
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="hover:text-brand-500 truncate block max-w-[180px]">
                          {lead.email}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[140px] truncate">{lead.address || "—"}</td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
                    <td className="px-5 py-3 font-semibold text-gray-800 dark:text-white">{lead.score || "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tierCfg.color}`}>{tier || "—"}</span>
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
