import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import { forecastNext14Days } from "../src/modules/predictor.js";
import { decidePurchase } from "../src/modules/decision.js";
import { importSales } from "../src/modules/salesHistory.js";
import { advanceCycle } from "../src/modules/stateMachine.js";
import { addLocalDays } from "../../shared/date.ts";
import { createScope, mustDefined, truncateAll } from "./helpers.js";

describe("forecastNext14Days", () => {
  it("predicts 0 without any data", () => {
    expect(forecastNext14Days([])).toEqual({
      windowDays: 0,
      dailyRate: 0,
      predictedTotal: 0,
      method: "trailing-average",
    });
  });

  it("uses the trailing 28-day window (including zero-sale days)", () => {
    const days = Array.from({ length: 40 }, () => ({ total: 10 }));
    const forecast = forecastNext14Days(days);
    expect(forecast.windowDays).toBe(28);
    expect(forecast.dailyRate).toBeCloseTo(10);
    expect(forecast.predictedTotal).toBe(140);
  });

  it("uses the whole (shorter) history when less than 28 days", () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ total: i === 0 ? 70 : 0 }));
    const forecast = forecastNext14Days(days);
    expect(forecast.windowDays).toBe(7);
    expect(forecast.dailyRate).toBeCloseTo(10);
    expect(forecast.predictedTotal).toBe(140);
  });

  it("rounds the predicted total to whole quantities", () => {
    const days = [
      { total: 1 },
      { total: 1 },
      { total: 1 },
      { total: 0 }, // rate 0.75 → 10.5 → 11
    ];
    expect(forecastNext14Days(days).predictedTotal).toBe(11);
  });
});

describe("decidePurchase", () => {
  beforeEach(truncateAll);

  it("suggests the gap between safety stock and live available", async () => {
    const scope = await createScope();
    const today = new Date();
    const d1 = addLocalDays(today, -1);
    const d2 = addLocalDays(today, -2);
    await importSales(scope, [
      { date: `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`, amount: 20 },
      { date: `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, "0")}-${String(d1.getDate()).padStart(2, "0")}`, amount: 20 },
    ]);
    // pending real order today: sold 10 → live available = -10
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 10, cycle: null, createdAt: new Date() },
    });

    const decision = await decidePurchase(scope);
    // window: 3 days (d-2, d-1, today), total 50 → rate 50/3 → ×14 ≈ 233
    expect(decision.available).toBe(-10);
    expect(decision.safetyStock).toBe(233);
    expect(decision.forecast.windowDays).toBe(3);
    expect(decision.suggestedAmount).toBe(243); // 233 - (-10)
    expect(decision.series).toHaveLength(3);
    expect(mustDefined(decision.series[0], "series day 0").imported).toBe(20);
    expect(mustDefined(decision.series[2], "series last day").real).toBe(10);
  });

  it("forecasts from a same-day-only sell (one-day window, not an empty series)", async () => {
    const scope = await createScope();
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 10, cycle: null, createdAt: new Date() },
    });

    const decision = await decidePurchase(scope);
    expect(decision.forecast.windowDays).toBe(1);
    expect(decision.safetyStock).toBe(140); // 10 / 1 day × 14
    expect(decision.available).toBe(-10);
    expect(decision.suggestedAmount).toBe(150); // 140 - (-10)
  });

  it("recommends nothing when available covers the safety stock", async () => {
    const scope = await createScope();
    // plenty of stock in a settled snapshot, tiny demand
    await advanceCycle(scope, { sent: 0, received: 300, sale: 5, purchase: 300 });
    const decision = await decidePurchase(scope);
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
    // series: yesterday 100 (imported) + today 30 (real sell) → window 2 days
    await importSales(scope, [{ date: localKeyOf(addLocalDays(new Date(), -1)), amount: 100 }]);
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 30, cycle: null, createdAt: new Date() },
    });

    const decision = await decidePurchase(scope);
    expect(decision.orderMultiple).toBe(20);
    expect(decision.safetyStock).toBe(910); // (100 + 30) / 2 × 14
    expect(decision.safetyStock - decision.available).toBe(940);
    expect(decision.suggestedAmount).toBe(940); // already a multiple of 20
  });

  it("rounds a small raw need up and keeps zero when nothing is needed", async () => {
    const scope = await createScope();
    await db.product.update({
      where: { id: scope.productId },
      data: { orderMultiple: 10 },
    });
    // raw need = 7 → rounds up to 10
    await importSales(scope, [{ date: localKeyOf(addLocalDays(new Date(), -1)), amount: 1 }]);
    const decision = await decidePurchase(scope);
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

function localKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
