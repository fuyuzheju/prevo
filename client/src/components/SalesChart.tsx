import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { SalesDay } from "../lib/types.ts";

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

type ChartInstance = ReturnType<typeof echarts.init>;

export function SalesChart({ series, height = 320 }: { series: readonly SalesDay[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      animation: false,
      grid: { left: 12, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) => String(value),
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: series.map((day) => day.date.slice(5)), // MM-DD
        axisLine: { lineStyle: { color: "#cbd5e1" } },
        axisLabel: { color: "#94a3b8", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#94a3b8", fontSize: 11 },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
      },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        { type: "slider", height: 18, bottom: 0, borderColor: "transparent" },
      ],
      series: [
        {
          name: "销量",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: series.length <= 40,
          data: series.map((day) => day.sale),
          lineStyle: { width: 2.5, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(37, 99, 235, 0.25)" },
                { offset: 1, color: "rgba(37, 99, 235, 0.02)" },
              ],
            },
          },
        },
      ],
    });
  }, [series]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="每日销量折线图，滚轮可缩放"
      style={{ height }}
      className="w-full"
    />
  );
}
