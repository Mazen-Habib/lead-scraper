"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type Props = {
  buckets: { label: string; count: number }[];
};

export default function ScoreHistogram({ buckets }: Props) {
  const options: ApexOptions = {
    chart: {
      type: "bar",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "70%",
        borderRadius: 4,
        borderRadiusApplication: "end",
        distributed: true,
      },
    },
    colors: [
      "#9ca3af", "#9ca3af", "#9ca3af",
      "#eab308", "#eab308",
      "#3b82f6", "#3b82f6",
      "#22c55e", "#22c55e", "#22c55e",
    ],
    dataLabels: { enabled: false },
    legend: { show: false },
    xaxis: {
      categories: buckets.map((b) => b.label),
      labels: {
        style: { fontSize: "11px", fontFamily: "Outfit, sans-serif", colors: "#6b7280" },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      title: {
        text: "Score range",
        style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", color: "#9ca3af" },
      },
    },
    yaxis: {
      labels: {
        style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", colors: "#6b7280" },
      },
    },
    grid: {
      borderColor: "#f3f4f6",
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-1 text-base font-semibold text-gray-800 dark:text-white">
        Score Distribution
      </h3>
      <p className="mb-4 text-xs text-gray-400">
        <span className="text-gray-400">■</span> D &nbsp;
        <span className="text-yellow-500">■</span> C &nbsp;
        <span className="text-blue-500">■</span> B &nbsp;
        <span className="text-green-500">■</span> A
      </p>
      <ReactApexChart
        options={options}
        series={[{ name: "Leads", data: buckets.map((b) => b.count) }]}
        type="bar"
        height={220}
      />
    </div>
  );
}
