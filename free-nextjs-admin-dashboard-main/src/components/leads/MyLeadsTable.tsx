"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/lead-types";
import { SOURCE_LABELS } from "@/lib/lead-types";

type DeliveredLead = Lead & {
  delivery_reason: string;
  first_delivered_at: string;
  saved_search_id: number | null;
};

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  D: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * Leads delivered to this user. The provenance badge is deliberate: 'Fresh'
 * means a scrape run actually discovered this lead for you, 'From corpus'
 * means it already existed and is only new to you. Conflating the two is
 * exactly how a "live leads" feature ends up lying to its users.
 */
function ProvenanceBadge({ reason }: { reason: string }) {
  const fresh = reason === "fresh";
  return (
    <span
      title={
        fresh
          ? "Discovered by a scrape run for this saved search"
          : "Already in the lead database — new to you, not newly scraped"
      }
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
        fresh
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {fresh ? "Fresh" : "From corpus"}
    </span>
  );
}

type Result = {
  forId: number | undefined;
  leads: DeliveredLead[];
  total: number;
  error: string | null;
};

export default function MyLeadsTable({ savedSearchId }: { savedSearchId?: number }) {
  const [result, setResult] = useState<Result | null>(null);

  // Derived rather than a setState inside the effect body: whenever the result
  // we hold isn't for the currently-requested search, we're loading. Keeps the
  // effect free of synchronous state updates (react-hooks/set-state-in-effect).
  const loading = result === null || result.forId !== savedSearchId;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (savedSearchId != null) params.set("savedSearchId", String(savedSearchId));

    fetch(`/api/my-leads?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not load your leads");
        if (cancelled) return;
        setResult({ forId: savedSearchId, leads: data.leads, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setResult({ forId: savedSearchId, leads: [], total: 0, error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [savedSearchId]);

  const leads = result?.leads ?? [];
  const total = result?.total ?? 0;
  const error = result?.error ?? null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-10 text-center text-gray-400">
        Loading your leads…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-10 text-center">
        <div className="text-3xl mb-2">📭</div>
        <p className="text-gray-500 dark:text-gray-400">
          No leads delivered yet. Press{" "}
          <span className="font-semibold text-gray-700 dark:text-gray-200">Run now</span> on a{" "}
          <Link href="/saved-searches" className="text-brand-500 hover:underline">
            saved search
          </Link>{" "}
          to scrape fresh ones.
        </p>
      </div>
    );
  }

  const freshCount = leads.filter((l) => l.delivery_reason === "fresh").length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-gray-700 dark:text-gray-200">{total.toLocaleString()}</span> leads
        delivered · <span className="font-semibold text-emerald-600 dark:text-emerald-400">{freshCount}</span> freshly
        scraped on this page
      </p>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-white/[0.02] text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                  Source
                </th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Origin</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden xl:table-cell">
                  Delivered
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {leads.map((lead, i) => (
                <tr key={`${lead.id ?? i}`} className="hover:bg-brand-50/50 dark:hover:bg-white/[0.03] transition-colors">
                  <td className="px-5 py-3.5 max-w-[220px]">
                    <div className="font-semibold text-gray-800 dark:text-white truncate">
                      {lead.company_name || "—"}
                    </div>
                    {lead.category && <div className="text-xs text-gray-400 truncate mt-0.5">{lead.category}</div>}
                  </td>
                  <td className="px-5 py-3.5 max-w-[200px]">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="block text-xs text-gray-600 dark:text-gray-300 hover:text-brand-500 truncate"
                      >
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600 text-xs">No email</span>
                    )}
                    {lead.phone && <div className="text-xs text-gray-400 truncate mt-0.5">{lead.phone}</div>}
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {SOURCE_LABELS[lead.source] ?? (lead.source || "—")}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-800 dark:text-white">{lead.score || "—"}</span>
                      {lead.tier && (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            TIER_COLORS[lead.tier] ?? TIER_COLORS.D
                          }`}
                        >
                          {lead.tier}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <ProvenanceBadge reason={lead.delivery_reason} />
                  </td>
                  <td className="px-5 py-3.5 hidden xl:table-cell text-xs text-gray-400 whitespace-nowrap">
                    {new Date(lead.first_delivered_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
