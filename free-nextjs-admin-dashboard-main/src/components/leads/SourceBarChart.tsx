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

  const options: ApexOptions = {
    chart: {
      type: "bar",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
        borderRadiusApplication: "end",
        barHeight: "60%",
      },
    },
    colors: ["#465fff"],
    dataLabels: {
      enabled: true,
      formatter: (val: number) => val.toLocaleString(),
      style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", fontWeight: "600" },
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
        style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", colors: "#374151" },
      },
    },
    grid: {
      borderColor: "#f3f4f6",
      strokeDashArray: 4,
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
    },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 text-base font-semibold text-gray-800 dark:text-white">
        Leads by Source
      </h3>
      <ReactApexChart
        options={options}
        series={[{ name: "Leads", data: values }]}
        type="bar"
        height={Math.max(200, sources.length * 48)}
      />
    </div>
  );
}
