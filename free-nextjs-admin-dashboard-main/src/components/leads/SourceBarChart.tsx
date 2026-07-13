"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import { SOURCE_LABELS } from "@/lib/lead-types";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  sources: { name: string; count: number }[];
};

export default function SourceBarChart({ sources }: Props) {
  const labels = sources.map((s) => SOURCE_LABELS[s.name] ?? s.name);
  const values = sources.map((s) => s.count);
  const total = values.reduce((a, b) => a + b, 0);

  const options: ApexOptions = {
    chart: {
      type: "bar",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      animations: { enabled: true, speed: 400 },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
        borderRadiusApplication: "end",
        barHeight: "55%",
      },
    },
    colors: ["#465fff"],
    dataLabels: {
      enabled: true,
      formatter: (val: number) => val.toLocaleString(),
      style: {
        fontSize: "12px",
        fontFamily: "Outfit, sans-serif",
        fontWeight: "600",
        colors: ["#fff"],
      },
    },
    xaxis: {
      categories: labels,
      labels: {
        style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", colors: "#6b7280" },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: {
          fontSize: "13px",
          fontFamily: "Outfit, sans-serif",
          colors: "#374151",
        },
      },
    },
    grid: {
      borderColor: "#f3f4f6",
      strokeDashArray: 4,
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
      padding: { left: 0, right: 8 },
    },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
      style: { fontFamily: "Outfit, sans-serif" },
    },
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Leads by Source
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {total.toLocaleString()} total across {sources.length} sources
          </p>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="min-w-[400px] xl:min-w-full">
          <ReactApexChart
            options={options}
            series={[{ name: "Leads", data: values }]}
            type="bar"
            height={Math.max(160, sources.length * 52)}
          />
        </div>
      </div>
    </div>
  );
}
