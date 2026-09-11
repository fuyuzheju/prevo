import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import { forecastNext14Days, type ForecastRequest } from "../src/modules/predictor.js";
import { decidePurchase } from "../src/modules/decision.js";
import { importSales } from "../src/modules/salesHistory.js";
import { advanceCycle } from "../src/modules/stateMachine.js";
import { addLocalDays } from "../../shared/date.ts";
import { createScope, mustDefined, truncateAll } from "./helpers.js";

function localKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Builds a request whose last day is today, so `asOfDate` is today and the
// series is contiguous — exactly what decidePurchase produces.
function requestFor(totals: readonly number[], skuId = "TEST-SKU"): ForecastRequest {
  return {
    skuId,
    skuName: skuId,
    asOfDate: localKeyOf(new Date()),
    dailyTotals: totals.map((total, index) => ({
      date: localKeyOf(addLocalDays(new Date(), index - (totals.length - 1))),
      total,
    })),
  };
}

describe("forecastNext14Days", () => {
  it("predicts 0 for a SKU with no history", async () => {
    await expect(forecastNext14Days(requestFor([]))).resolves.toEqual({
      windowDays: 0,
      dailyRate: 0,
      predictedTotal: 0,
      method: "ALL_ZERO",
    });
  });

  it("uses a 28-day mean once 28-55 days of history exist", async () => {
    const forecast = await forecastNext14Days(requestFor(Array.from({ length: 40 }, () => 10)));
    expect(forecast.windowDays).toBe(28);
    expect(forecast.dailyRate).toBeCloseTo(10);
    expect(forecast.predictedTotal).toBeCloseTo(140);
    expect(forecast.method).toBe("MA_28_FALLBACK");
  });

  it("uses the whole history when it is shorter than 28 days", async () => {
    const forecast = await forecastNext14Days(requestFor([70, 0, 0, 0, 0, 0, 0]));
    expect(forecast.windowDays).toBe(7);
    expect(forecast.dailyRate).toBeCloseTo(10);
    expect(forecast.predictedTotal).toBeCloseTo(140);
    expect(forecast.method).toBe("FULL_MEAN_FALLBACK");
  });

  it("keeps full precision instead of rounding the predicted total", async () => {
    // rate 0.75 → 0.75 × 14 = 10.5, deliberately NOT rounded to 11
    const forecast = await forecastNext14Days(requestFor([1, 1, 1, 0]));
    expect(forecast.dailyRate).toBeCloseTo(0.75);
    expect(forecast.predictedTotal).toBeCloseTo(10.5);
  });

  it("preserves a constant series exactly over the full window", async () => {
    // Self-normalizing weights: a flat series must come back unchanged.
    const forecast = await forecastNext14Days(requestFor(Array.from({ length: 90 }, () => 5)));
    expect(forecast.method).toBe("WMA_84");
    expect(forecast.windowDays).toBe(84);
    expect(forecast.dailyRate).toBeCloseTo(5);
    expect(forecast.predictedTotal).toBeCloseTo(70);
  });

  it("weights recent days more heavily than old ones", async () => {
    // Ascending 1..84 across the window: level = Σ(k², k=1..84) / Σ(k, k=1..84).
    const ascending = Array.from({ length: 84 }, (_, i) => i + 1);
    const forecast = await forecastNext14Days(requestFor(ascending));
    const handComputed = 201110 / 3570; // Σk² / Σk for k = 1..84
    expect(forecast.method).toBe("WMA_84");
    expect(forecast.dailyRate).toBeCloseTo(handComputed, 9);
    expect(forecast.predictedTotal).toBeCloseTo(handComputed * 14, 6);

    // The same series reversed must come out strictly lower: that is the whole
    // point of the weighting, and it fails if the weights are applied backwards.
    const reversed = [...ascending].reverse();
    const flipped = await forecastNext14Days(requestFor(reversed));
    expect(flipped.dailyRate).toBeLessThan(handComputed);
  });
});

describe("decidePurchase", () => {
  beforeEach(truncateAll);

  it("suggests the gap between safety stock and live available", async () => {
    const scope = await createScope();
    const d1 = addLocalDays(new Date(), -1);
    const d2 = addLocalDays(new Date(), -2);
    await importSales(scope, [
      { date: localKeyOf(d2), amount: 20 },
      { date: localKeyOf(d1), amount: 20 },
    ]);
    // pending real order today: sold 10 → live available = -10
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 10, cycle: null, createdAt: new Date() },
    });

    const decision = await decidePurchase(scope);
    // 3 days of history (d-2, d-1, today), total 50 → full-history mean 50/3
    expect(decision.available).toBe(-10);
    expect(decision.safetyStock).toBeCloseTo((50 / 3) * 14, 6);
    expect(decision.forecast.windowDays).toBe(3);
    expect(decision.forecast.method).toBe("FULL_MEAN_FALLBACK");
    expect(decision.suggestedAmount).toBe(244); // ceil(233.33 + 10)
    expect(decision.series).toHaveLength(3);
    expect(mustDefined(decision.series[0], "series day 0").imported).toBe(20);
    expect(mustDefined(decision.series[2], "series last day").real).toBe(10);
  });

  it("recommends nothing when available covers the safety stock", async () => {
    const scope = await createScope();
    // plenty of stock in a settled snapshot, and no sales history at all
    await advanceCycle(scope, { sent: 0, received: 300, sale: 5, purchase: 300 });
    const decision = await decidePurchase(scope);
    expect(decision.safetyStock).toBe(0);
    expect(decision.available).toBeGreaterThanOrEqual(decision.safetyStock);
    expect(decision.suggestedAmount).toBe(0);
  });

  it("extrapolates the live position through pending records", async () => {
    const scope = await createScope();
    await advanceCycle(scope, { sent: 0, received: 100, sale: 0, purchase: 100 });
    await db.scopeRecord.create({
      data: { ...scope, kind: "RECEIVE", amount: 30, cycle: null, createdAt: new Date() },
    });
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 20, cycle: null, createdAt: new Date() },
    });
    const decision = await decidePurchase(scope);
    // inventory 100 + pending received 30 − sold 20, minus the 30 now out of transit
    expect(decision.available).toBe(80);
  });

  it("rounds the suggestion up to the product's orderMultiple", async () => {
    const scope = await createScope();
    await db.product.update({
      where: { id: scope.productId },
      data: { orderMultiple: 20 },
    });
    // series: yesterday 100 (imported) + today 30 (real sell) → 2 days
    await importSales(scope, [{ date: localKeyOf(addLocalDays(new Date(), -1)), amount: 100 }]);
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 30, cycle: null, createdAt: new Date() },
    });

    const decision = await decidePurchase(scope);
    expect(decision.orderMultiple).toBe(20);
    expect(decision.safetyStock).toBeCloseTo((130 / 2) * 14, 6); // 910
    expect(decision.safetyStock - decision.available).toBeCloseTo(940, 6);
    expect(decision.suggestedAmount).toBe(940); // already a multiple of 20
  });

  it("rounds a small raw need up and keeps zero when nothing is needed", async () => {
    const scope = await createScope();
    await db.product.update({
      where: { id: scope.productId },
      data: { orderMultiple: 10 },
    });
    // 2 days (yesterday 1, today 0) → mean 0.5 → 14d total 7, rounded up to 10
    await importSales(scope, [{ date: localKeyOf(addLocalDays(new Date(), -1)), amount: 1 }]);
    const decision = await decidePurchase(scope);
    expect(decision.safetyStock).toBeCloseTo(7, 6);
    expect(decision.suggestedAmount).toBe(10);
    expect(decision.suggestedAmount % 10).toBe(0);

    // plenty of stock: raw need ≤ 0 stays 0
    const stocked = await createScope();
    await db.product.update({
      where: {
        id: stocked.productId,
      },
      data: { orderMultiple: 50 },
    });
    await advanceCycle(stocked, { sent: 0, received: 500, sale: 5, purchase: 500 });
    const none = await decidePurchase(stocked);
    expect(none.suggestedAmount).toBe(0);
  });
});
