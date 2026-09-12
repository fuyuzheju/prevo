import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { Granularity, SeriesPoint } from "../lib/series.ts";
import { formatQuantity } from "../../../shared/quantity.ts";

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

type ChartInstance = ReturnType<typeof echarts.init>;

const GRANULARITY_LABEL: Record<Granularity, string> = { day: "天", week: "周", month: "月" };

// The axis tooltip is handed the raw echarts params; only the dataIndex of the
// first entry is needed to look up the aggregated point.
function dataIndexOf(params: unknown): number | null {
  if (typeof params !== "object" || params === null || !("dataIndex" in params)) return null;
  const value = params.dataIndex;
  return typeof value === "number" ? value : null;
}

export function SalesChart({
  points,
  granularity,
  height = 320,
}: {
  points: readonly SeriesPoint[];
  granularity: Granularity;
  height?: number;
}) {
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
        formatter: (params: unknown) => {
          const index = dataIndexOf(params);
          const point = index === null ? undefined : points[index];
          if (point === undefined) return "";
          // values are fixed-point quantities; show the user-facing decimal
          const heading =
            granularity === "day" ? point.range : `${point.range}（共 ${point.days} 天）`;
          return `${heading}<br/>销量 ${formatQuantity(point.sale)}`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((point) => point.label),
        axisLine: { lineStyle: { color: "#cbd5e1" } },
        axisLabel: { color: "#94a3b8", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (value: number) => formatQuantity(value),
        },
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
          showSymbol: points.length <= 40,
          data: points.map((point) => point.sale),
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
  }, [points, granularity]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`销量折线图（按${GRANULARITY_LABEL[granularity]}汇总），滚轮 / 拖拽底部滑块可缩放`}
      style={{ height }}
      className="w-full"
    />
  );
}
