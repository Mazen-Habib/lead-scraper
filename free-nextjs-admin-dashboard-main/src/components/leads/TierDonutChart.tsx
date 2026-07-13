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

  const options: ApexOptions = {
    chart: {
      type: "donut",
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
    },
    labels: ["Tier A", "Tier B", "Tier C", "Tier D"],
    colors: ["#22c55e", "#3b82f6", "#eab308", "#9ca3af"],
    legend: {
      show: true,
      position: "bottom",
      fontFamily: "Outfit, sans-serif",
      fontSize: "13px",
      labels: { colors: "#6b7280" },
      markers: { size: 8 },
    },
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${Math.round(val)}%`,
      style: { fontSize: "12px", fontFamily: "Outfit, sans-serif", fontWeight: "600" },
      dropShadow: { enabled: false },
    },
    plotOptions: {
      pie: {
        donut: {
          size: "60%",
          labels: {
            show: true,
            total: {
              show: true,
              label: "Total",
              fontSize: "13px",
              fontFamily: "Outfit, sans-serif",
              color: "#6b7280",
              formatter: () => total.toLocaleString(),
            },
            value: {
              fontSize: "22px",
              fontWeight: "700",
              fontFamily: "Outfit, sans-serif",
              color: "#111827",
            },
          },
        },
      },
    },
    stroke: { width: 2, colors: ["transparent"] },
    tooltip: {
      y: { formatter: (val: number) => `${val.toLocaleString()} leads` },
    },
    responsive: [{ breakpoint: 480, options: { chart: { height: 260 } } }],
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="mb-4 text-base font-semibold text-gray-800 dark:text-white">
        Tier Distribution
      </h3>
      <ReactApexChart options={options} series={series} type="donut" height={300} />
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {(["A", "B", "C", "D"] as const).map((t) => {
          const colors = { A: "text-green-500", B: "text-blue-500", C: "text-yellow-500", D: "text-gray-400" };
          return (
            <div key={t}>
              <div className={`text-lg font-bold ${colors[t]}`}>{counts[t].toLocaleString()}</div>
              <div className="text-xs text-gray-500">Tier {t}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
