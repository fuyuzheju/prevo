import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import {
  buildDailySalesSeries,
  clearImported,
  importSales,
  importSalesMany,
  listImported,
  removeImported,
} from "../src/modules/salesHistory.js";
import { ApiError } from "../src/errors.js";
import { addLocalDays } from "../../shared/date.ts";
import {
  createProduct,
  createScope,
  createUser,
  mustDefined,
  scopeFor,
  truncateAll,
} from "./helpers.js";

function keyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): string {
  return keyOf(addLocalDays(new Date(), -n));
}

describe("importSales validation", () => {
  beforeEach(truncateAll);

  it("rejects bad dates, amounts and empty batches", async () => {
    const scope = await createScope();
    for (const bad of [
      { entries: [] },
      { entries: "nope" },
      { entries: [{ date: "2026-13-01", amount: 5 }] },
      { entries: [{ date: "2026-02-30", amount: 5 }] }, // rolls over to March
      { entries: [{ date: "2026/08/01", amount: 5 }] },
      { entries: [{ date: daysAgo(1), amount: 0 }] },
      { entries: [{ date: daysAgo(1), amount: -3 }] },
      { entries: [{ date: daysAgo(1), amount: 1.5 }] },
    ]) {
      await expect(importSales(scope, bad.entries)).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("imports valid entries and lists them newest first", async () => {
    const scope = await createScope();
    const count = await importSales(scope, [
      { date: daysAgo(3), amount: 10 },
      { date: daysAgo(1), amount: 25 },
      { date: daysAgo(1), amount: 5 }, // duplicates allowed, they add up
    ]);
    expect(count).toBe(3);
    const entries = await listImported(scope);
    expect(entries).toHaveLength(3);
    // newest date first; the two same-day entries differ only in id order
    expect(mustDefined(entries[0], "entry 0").date).toBe(daysAgo(1));
    expect(mustDefined(entries[1], "entry 1").date).toBe(daysAgo(1));
    expect(mustDefined(entries[2], "entry 2").date).toBe(daysAgo(3));
    expect(entries.map((e) => e.amount).sort((a, b) => b - a)).toEqual([25, 10, 5]);
  });
});

describe("buildDailySalesSeries", () => {
  beforeEach(truncateAll);

  it("merges real orders and imported sales into a contiguous daily series", async () => {
    const scope = await createScope();
    await importSales(scope, [
      { date: daysAgo(3), amount: 20 },
      { date: daysAgo(1), amount: 5 },
    ]);
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 10, cycle: null, createdAt: new Date() },
    });
    await db.scopeRecord.create({
      data: { ...scope, kind: "SELL", amount: 7, cycle: null, createdAt: addLocalDays(new Date(), -1) },
    });
    await db.scopeRecord.create({
      data: { ...scope, kind: "PURCHASE", amount: 999, cycle: null, createdAt: new Date() },
    });

    const series = await buildDailySalesSeries(scope);
    expect(series).toHaveLength(4); // d-3 .. today, contiguous
    expect(series[0]).toEqual({ date: daysAgo(3), real: 0, imported: 20, sale: 20 });
    expect(series[2]).toEqual({ date: daysAgo(1), real: 7, imported: 5, sale: 12 }); // same day merged
    expect(series[3]).toEqual({ date: daysAgo(0), real: 10, imported: 0, sale: 10 });
    // purchases never appear in the series
    expect(series.reduce((sum, day) => sum + day.sale, 0)).toBe(42);
  });

  it("returns an empty series without any data and isolates scopes", async () => {
    const scope = await createScope();
    expect(await buildDailySalesSeries(scope)).toEqual([]);
    const other = scopeFor(await createUser("other"), scope.productType);
    await importSales(scope, [{ date: daysAgo(1), amount: 9 }]);
    expect(await buildDailySalesSeries(other)).toEqual([]);
  });
});

describe("importSalesMany (multi-product)", () => {
  beforeEach(truncateAll);

  it("imports rows for several existing products in one batch", async () => {
    const userId = await createUser("owner");
    await createProduct(userId, "tee");
    await createProduct(userId, "shirt");

    const imported = await importSalesMany(userId, [
      { productType: "tee", date: daysAgo(2), amount: 10 },
      { productType: "tee", date: daysAgo(1), amount: 20 },
      { productType: "shirt", date: daysAgo(1), amount: 5 },
    ]);
    expect(imported).toBe(3);
    expect(await listImported(scopeFor(userId, "tee"))).toHaveLength(2);
    expect(await listImported(scopeFor(userId, "shirt"))).toHaveLength(1);
  });

  it("rejects the whole batch when any product is missing", async () => {
    const userId = await createUser("owner");
    await createProduct(userId, "tee");
    await expect(
      importSalesMany(userId, [
        { productType: "tee", date: daysAgo(1), amount: 5 },
        { productType: "ghost", date: daysAgo(1), amount: 7 },
      ]),
    ).rejects.toMatchObject({
      status: 400,
      code: "PRODUCT_NOT_FOUND",
    });
    // nothing was inserted
    expect(await db.importedSale.count()).toBe(0);
  });

  it("validates product names, dates and amounts in bulk rows", async () => {
    const userId = await createUser("owner");
    await createProduct(userId, "tee");
    for (const bad of [
      { productType: "has space", date: daysAgo(1), amount: 5 },
      { productType: "tee", date: "2026-02-30", amount: 5 },
      { productType: "tee", date: daysAgo(1), amount: 0 },
      { productType: "tee", date: daysAgo(1), amount: 2.5 },
    ]) {
      await expect(importSalesMany(userId, [bad])).rejects.toBeInstanceOf(ApiError);
    }
    expect(await db.importedSale.count()).toBe(0);
  });
});

describe("removeImported and clearImported", () => {
  beforeEach(truncateAll);

  it("removes one entry and clears the product", async () => {
    const scope = await createScope();
    await importSales(scope, [{ date: daysAgo(2), amount: 3 }]);
    await importSales(scope, [{ date: daysAgo(1), amount: 4 }]);
    const [first] = await listImported(scope);
    const firstEntry = mustDefined(first, "first imported entry");

    await removeImported(scope, firstEntry.id);
    expect(await listImported(scope)).toHaveLength(1);
    await expect(removeImported(scope, firstEntry.id)).rejects.toMatchObject({ status: 404 });

    await clearImported(scope);
    expect(await listImported(scope)).toEqual([]);
  });
});
