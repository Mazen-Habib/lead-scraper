"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  counts: { A: number; B: number; C: number; D: number };
};

export default function TierDonutChart({ counts }: Props) {
  const series = [counts.A, counts.B, counts.C, counts.D];
  const total = series.reduce((a, b) => a + b, 0);
  const hasData = total > 0;

  const options: ApexOptions = {
    chart: {
      type: "donut",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 400 },
    },
    labels: ["Tier A", "Tier B", "Tier C", "Tier D"],
    colors: ["#465fff", "#22c55e", "#eab308", "#9ca3af"],
    legend: { show: false },
    dataLabels: {
      enabled: false,
    },
    plotOptions: {
      pie: {
        donut: {
          size: "70%",
          labels: {
            show: hasData,
            total: {
              show: true,
              label: "Total",
              fontSize: "12px",
              fontWeight: "400",
              fontFamily: "Outfit, sans-serif",
              color: "#6b7280",
              formatter: () => total.toLocaleString(),
            },
            value: {
              fontSize: "28px",
              fontWeight: "700",
              fontFamily: "Outfit, sans-serif",
              color: "#111827",
              offsetY: 4,
            },
          },
        },
      },
    },
    stroke: { width: 0 },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
      style: { fontFamily: "Outfit, sans-serif" },
    },
  };

  const tiers = [
    { key: "A" as const, label: "Tier A — Top",    color: "#465fff", bg: "bg-brand-500" },
    { key: "B" as const, label: "Tier B — Strong",  color: "#22c55e", bg: "bg-success-500" },
    { key: "C" as const, label: "Tier C — Qualified", color: "#eab308", bg: "bg-warning-500" },
    { key: "D" as const, label: "Tier D — Weak",   color: "#9ca3af", bg: "bg-gray-400" },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Tier Distribution
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Lead quality breakdown by scoring tier
        </p>
      </div>

      {hasData ? (
        <div className="relative">
          <ReactApexChart options={options} series={series} type="donut" height={220} />
        </div>
      ) : (
        <div className="flex h-[220px] items-center justify-center">
          <p className="text-sm text-gray-400">
            Scores populate after next scraper run
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 space-y-3">
        {tiers.map((t) => {
          const pct = total > 0 ? Math.round((counts[t.key] / total) * 100) : 0;
          return (
            <div key={t.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                <span className="text-sm text-gray-600 dark:text-gray-400">{t.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: t.color }} />
                </div>
                <span className="w-8 text-right text-sm font-medium text-gray-800 dark:text-white/90">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
