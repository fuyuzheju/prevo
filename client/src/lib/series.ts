// Aggregation of the daily sales series for the prediction chart. Weeks are
// whole calendar weeks starting Monday; the first and last bucket can be
// partial (the series starts at the first data day and always ends today).
import { localDateKey, parseLocalDateKey } from "../../../shared/date.ts";
import type { SalesDay } from "./types.ts";

export type Granularity = "day" | "week" | "month";

export interface SeriesPoint {
  label: string; // x-axis label
  range: string; // covered period, shown in the tooltip
  days: number; // number of daily values folded into this point
  sale: number;
}

export function aggregateSeries(
  series: readonly SalesDay[],
  granularity: Granularity,
): SeriesPoint[] {
  if (granularity === "day") {
    return series.map((day) => ({
      label: day.date.slice(5), // MM-DD
      range: day.date,
      days: 1,
      sale: day.sale,
    }));
  }

  interface Bucket {
    key: string;
    first: string;
    last: string;
    days: number;
    sale: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const day of series) {
    const key = granularity === "week" ? weekKeyOf(day.date) : day.date.slice(0, 7);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { key, first: day.date, last: day.date, days: 1, sale: day.sale });
    } else {
      bucket.last = day.date;
      bucket.days += 1;
      bucket.sale += day.sale;
    }
  }
  return [...buckets.values()].map((bucket) => ({
    label: granularity === "week" ? bucket.key.slice(5) : bucket.key,
    range: bucket.first === bucket.last ? bucket.first : `${bucket.first} ~ ${bucket.last}`,
    days: bucket.days,
    sale: bucket.sale,
  }));
}

// 'YYYY-MM-DD' of the Monday of the local calendar week containing dateKey.
function weekKeyOf(dateKey: string): string {
  const date = parseLocalDateKey(dateKey);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return localDateKey(date);
}
