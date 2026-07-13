"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  buckets: { label: string; count: number }[];
};

// color per bucket index: 0-2 = D (gray), 3-4 = C (amber), 5-6 = B (blue), 7-9 = A (green)
const BUCKET_COLORS = [
  "#9ca3af","#9ca3af","#9ca3af",
  "#eab308","#eab308",
  "#3b82f6","#3b82f6",
  "#22c55e","#22c55e","#22c55e",
];

export default function ScoreHistogram({ buckets }: Props) {
  const totalScored = buckets.slice(1).reduce((s, b) => s + b.count, 0);
  const unscored = buckets[0]?.count ?? 0;
  const hasRealScores = totalScored > 0;

  const options: ApexOptions = {
    chart: {
      type: "bar",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 600 },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "68%",
        borderRadius: 5,
        borderRadiusApplication: "end",
        distributed: true,
      },
    },
    colors: BUCKET_COLORS,
    dataLabels: { enabled: false },
    legend: { show: false },
    xaxis: {
      categories: buckets.map((b) => b.label),
      labels: {
        style: { fontSize: "10px", fontFamily: "Outfit, sans-serif", colors: "#9ca3af" },
        rotate: -30,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { fontSize: "11px", fontFamily: "Outfit, sans-serif", colors: "#9ca3af" },
      },
      min: 0,
    },
    grid: {
      borderColor: "#f3f4f6",
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
      padding: { left: 0, right: 0 },
    },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white">Score Distribution</h3>
          <p className="text-xs text-gray-400 mt-0.5">Composite lead quality (0–100)</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs text-gray-400 mt-0.5">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" /> D</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" /> C</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> B</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> A</span>
        </div>
      </div>

      {!hasRealScores && unscored > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <span>⚠️</span>
          <span>{unscored.toLocaleString()} leads await scoring — trigger a scraper run to compute scores</span>
        </div>
      )}

      <ReactApexChart
        options={options}
        series={[{ name: "Leads", data: buckets.map((b) => b.count) }]}
        type="bar"
        height={220}
      />
    </div>
  );
}
