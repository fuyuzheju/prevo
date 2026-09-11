// Sale predictor. The forecast model is deliberately simple and lives only
// in this module, so a better model (seasonality, ML, ...) can replace it
// without touching anything else.
//
// Semantics: the safety stock of a product is the predicted total sales of
// the NEXT TWO WEEKS. We estimate the recent daily run-rate as the average
// daily sales over the trailing 28 calendar days (or since the first data
// day when history is shorter), including days without sales, then scale it
// to 14 days. Amounts are signed fixed-point quantities, so a return day
// counts as negative sales and lowers the rate.

const WINDOW_DAYS = 28;
const HORIZON_DAYS = 14;
export const FORECAST_METHOD = "trailing-average";

export interface TwoWeekForecast {
  windowDays: number;
  dailyRate: number;
  predictedTotal: number;
  method: typeof FORECAST_METHOD;
}

// `dailyTotals` must be one entry per contiguous calendar day (values may be
// 0), covering at least the trailing window up to today. Only the most recent
// entries within the window are used.
export function forecastNext14Days(dailyTotals: readonly { total: number }[]): TwoWeekForecast {
  const window = dailyTotals.slice(-WINDOW_DAYS);
  const windowDays = window.length;
  if (windowDays === 0) {
    return { windowDays: 0, dailyRate: 0, predictedTotal: 0, method: FORECAST_METHOD };
  }
  const total = window.reduce((sum, day) => sum + day.total, 0);
  const dailyRate = total / windowDays;
  const predictedTotal = Math.round(dailyRate * HORIZON_DAYS);
  return { windowDays, dailyRate, predictedTotal, method: FORECAST_METHOD };
}
