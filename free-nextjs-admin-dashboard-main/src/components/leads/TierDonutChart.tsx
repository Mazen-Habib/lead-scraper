"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  counts: { A: number; B: number; C: number; D: number };
};

const TIERS = [
  { key: "A" as const, label: "Tier A", color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20", hex: "#22c55e", desc: "Top quality" },
  { key: "B" as const, label: "Tier B", color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20", hex: "#3b82f6", desc: "Strong" },
  { key: "C" as const, label: "Tier C", color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20", hex: "#eab308", desc: "Qualified" },
  { key: "D" as const, label: "Tier D", color: "text-gray-400", bg: "bg-gray-50 dark:bg-gray-800/50", hex: "#9ca3af", desc: "Weak" },
];

export default function TierDonutChart({ counts }: Props) {
  const series = [counts.A, counts.B, counts.C, counts.D];
  const total = series.reduce((a, b) => a + b, 0);
  const hasData = total > 0;

  const options: ApexOptions = {
    chart: {
      type: "donut",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 600 },
    },
    labels: TIERS.map((t) => t.label),
    colors: TIERS.map((t) => t.hex),
    legend: { show: false },
    dataLabels: {
      enabled: hasData,
      formatter: (val: number) => `${Math.round(val)}%`,
      style: { fontSize: "11px", fontFamily: "Outfit, sans-serif", fontWeight: "600" },
      dropShadow: { enabled: false },
    },
    plotOptions: {
      pie: {
        donut: {
          size: "65%",
          labels: {
            show: hasData,
            total: {
              show: true,
              label: "Total",
              fontSize: "13px",
              fontFamily: "Outfit, sans-serif",
              color: "#6b7280",
              formatter: () => total.toLocaleString(),
            },
            value: {
              fontSize: "24px",
              fontWeight: "700",
              fontFamily: "Outfit, sans-serif",
              color: "#111827",
            },
          },
        },
      },
    },
    stroke: { width: hasData ? 2 : 0, colors: ["transparent"] },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white">Tier Distribution</h3>
        <p className="text-xs text-gray-400 mt-0.5">Lead quality breakdown by tier</p>
      </div>

      {hasData ? (
        <ReactApexChart options={options} series={series} type="donut" height={260} />
      ) : (
        <div className="h-[260px] flex flex-col items-center justify-center gap-2">
          <div className="w-28 h-28 rounded-full border-[12px] border-dashed border-gray-100 dark:border-gray-800 flex items-center justify-center">
            <span className="text-2xl">⏳</span>
          </div>
          <p className="text-sm text-gray-400 text-center max-w-[180px] leading-relaxed">
            Tiers populate after the<br />next scraper run
          </p>
        </div>
      )}

      {/* Legend grid — always show */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {TIERS.map((t) => {
          const pct = total > 0 ? Math.round((counts[t.key] / total) * 100) : 0;
          return (
            <div key={t.key} className={`rounded-xl px-3 py-2.5 ${t.bg} flex items-center gap-3`}>
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.hex }} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-lg font-bold ${t.color}`}>{counts[t.key].toLocaleString()}</span>
                  {total > 0 && <span className="text-xs text-gray-400">{pct}%</span>}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t.label} — {t.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
