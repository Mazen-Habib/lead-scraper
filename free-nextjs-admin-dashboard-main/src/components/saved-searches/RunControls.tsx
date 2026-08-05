"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type ScrapeRun = {
  id: number;
  status: "pending" | "running" | "done" | "failed" | string;
  trigger: string;
  started_at: string | null;
  finished_at: string | null;
  leads_found: number | null;
  error: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

const POLL_MS = 10000;

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * "Run now" / "Deep scan" plus the live status of the latest run.
 *
 * Everything rendered here comes from a real scrape_runs row fetched from the
 * API — there is no optimistic "success" state. While a run is queued or
 * running we poll; a failed run shows the worker's actual error text rather
 * than silently looking like an empty result.
 */
export default function RunControls({ savedSearchId }: { savedSearchId: number }) {
  const [latest, setLatest] = useState<ScrapeRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/saved-searches/${savedSearchId}/runs?limit=1`);
      if (!res.ok) return null;
      const data = (await res.json()) as { runs: ScrapeRun[] };
      const run = data.runs?.[0] ?? null;
      setLatest(run);
      return run;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [savedSearchId]);

  // Poll only while there's something actually in flight.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const run = await fetchRuns();
      if (cancelled) return;
      if (run && (run.status === "pending" || run.status === "running")) {
        timerRef.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchRuns]);

  const startRun = async (depth: "quick" | "deep") => {
    setStarting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/saved-searches/${savedSearchId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Could not start the run.");
      }
      await fetchRuns();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not start the run.");
    } finally {
      setStarting(false);
    }
  };

  const inFlight = latest?.status === "pending" || latest?.status === "running";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => startRun("quick")}
          disabled={starting || inFlight}
          className="rounded-lg bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
        >
          {inFlight ? "Run in progress…" : starting ? "Starting…" : "Run now"}
        </button>
        <button
          onClick={() => startRun("deep")}
          disabled={starting || inFlight}
          title="Scrapes every supported directory — slower, wider coverage"
          className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          Deep scan
        </button>

        {!loading && latest && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[latest.status] ?? STATUS_STYLES.pending}`}>
            {STATUS_LABELS[latest.status] ?? latest.status}
          </span>
        )}
      </div>

      {!loading && latest && (
        <p className="text-[11px] text-gray-400">
          {latest.status === "done" && (
            <>
              {latest.leads_found ?? 0} new lead{latest.leads_found === 1 ? "" : "s"} delivered
              {latest.finished_at ? ` · ${formatWhen(latest.finished_at)}` : ""}
            </>
          )}
          {latest.status === "running" && <>Scraping now · started {formatWhen(latest.started_at)}</>}
          {latest.status === "pending" && <>Queued · waiting for the scrape worker to pick it up</>}
          {latest.status === "failed" && (
            <span className="text-red-500">Failed: {latest.error || "unknown error"}</span>
          )}
        </p>
      )}

      {!loading && !latest && (
        <p className="text-[11px] text-gray-400">Never run — press Run now to scrape fresh leads for this search.</p>
      )}

      {message && <p className="text-[11px] text-red-500">{message}</p>}
    </div>
  );
}
