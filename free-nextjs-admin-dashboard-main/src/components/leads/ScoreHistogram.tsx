"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  buckets: { label: string; count: number }[];
};

const BUCKET_COLORS = [
  "#9ca3af","#9ca3af","#9ca3af",
  "#eab308","#eab308",
  "#465fff","#465fff",
  "#22c55e","#22c55e","#22c55e",
];

export default function ScoreHistogram({ buckets }: Props) {
  const totalScored = buckets.slice(1).reduce((s, b) => s + b.count, 0);
  const unscored = buckets[0]?.count ?? 0;

  const options: ApexOptions = {
    chart: {
      type: "bar",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 400 },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "60%",
        borderRadius: 4,
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
        style: {
          fontSize: "10px",
          fontFamily: "Outfit, sans-serif",
          colors: Array(10).fill("#6b7280"),
        },
        rotate: 0,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", colors: ["#6b7280"] },
      },
    },
    grid: {
      borderColor: "#f3f4f6",
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
      padding: { left: -10, right: 0 },
    },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
      style: { fontFamily: "Outfit, sans-serif" },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Score Distribution
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Composite lead quality (0–100)
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mt-1">
          <span className="flex items-center gap-1.5">
            <span className="block h-2 w-2 rounded-full bg-gray-400" />D
          </span>
          <span className="flex items-center gap-1.5">
            <span className="block h-2 w-2 rounded-full bg-warning-500" />C
          </span>
          <span className="flex items-center gap-1.5">
            <span className="block h-2 w-2 rounded-full bg-brand-500" />B
          </span>
          <span className="flex items-center gap-1.5">
            <span className="block h-2 w-2 rounded-full bg-success-500" />A
          </span>
        </div>
      </div>

      {!totalScored && unscored > 0 && (
        <div className="mb-4 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-600 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-orange-400">
          {unscored.toLocaleString()} leads await scoring — trigger a scraper run to compute scores
        </div>
      )}

      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="min-w-[400px] xl:min-w-full">
          <ReactApexChart
            options={options}
            series={[{ name: "Leads", data: buckets.map((b) => b.count) }]}
            type="bar"
            height={220}
          />
        </div>
      </div>
    </div>
  );
}
