import { db, type DbClient } from "../db.js";
import { ApiError } from "../errors.js";
import { isValidProductName, type Scope } from "../../../shared/model.ts";
import { isQuantity } from "../../../shared/quantity.ts";
import {
  addLocalDays,
  isFutureDateKey,
  localDateKey,
  parseLocalDateKey,
} from "../../../shared/date.ts";

// Imported historical sales are a prediction-only dataset: they never touch
// the state machine, the ledger or the live position. Real orders (SELL
// records) enter the prediction dataset through buildDailySalesSeries.

export interface ImportedSaleEntry {
  id: number;
  date: string; // 'YYYY-MM-DD' (local)
  amount: number;
}

export interface SalesDay {
  date: string; // 'YYYY-MM-DD' (local)
  real: number; // sales from real orders (SELL records)
  imported: number; // sales from imported history
  sale: number; // real + imported
}

interface SalesDb {
  scopeRecord: DbClient["scopeRecord"];
  importedSale: DbClient["importedSale"];
  product: DbClient["product"];
}

function scopeWhere(scope: Scope) {
  return { userId: scope.userId, productId: scope.productId };
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ImportRow {
  productType: string;
  date: string;
  amount: number;
}

// Validates a batch of {productType?, date, amount} rows; date/amount rules
// are shared by the single-product and the multi-product import.
function assertRows(entries: unknown): { date: string; amount: number; productType?: unknown }[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ApiError(400, "INVALID_BODY", "entries must be a non-empty array");
  }
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ApiError(400, "INVALID_BODY", "each entry must be an object");
    }
    const productType = "productType" in entry ? entry.productType : undefined;
    const dateRaw = "date" in entry ? entry.date : undefined;
    const amountRaw = "amount" in entry ? entry.amount : undefined;
    const key = typeof dateRaw === "string" ? dateRaw : "";
    // round-trip guards against rolled-over dates like 2026-02-30
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(key) ? parseLocalDateKey(key) : new Date(NaN);
    if (!DATE_KEY_RE.test(key) || localDateKey(parsed) !== key) {
      throw new ApiError(400, "INVALID_DATE", `invalid date "${key}", expected YYYY-MM-DD`);
    }
    // future days would extend the prediction series past today
    if (isFutureDateKey(key)) {
      throw new ApiError(400, "INVALID_DATE", `date "${key}" is in the future`);
    }
    if (!isQuantity(amountRaw)) {
      throw new ApiError(400, "INVALID_AMOUNT", "amount must be an integer number of 1/1000 units");
    }
    return { productType, date: key, amount: amountRaw };
  });
}

export async function listImported(
  scope: Scope,
  client: SalesDb = db,
): Promise<ImportedSaleEntry[]> {
  const rows = await client.importedSale.findMany({
    where: scopeWhere(scope),
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true, date: true, amount: true },
  });
  return rows.map((row) => ({ id: row.id, date: localDateKey(row.date), amount: row.amount }));
}

// Append imported history for one product. Duplicate (product, date) entries
// are allowed and simply add up in the series. Returns rows inserted.
export async function importSales(
  scope: Scope,
  entries: unknown,
  client: SalesDb = db,
): Promise<number> {
  const parsed = assertRows(entries);
  await client.importedSale.createMany({
    data: parsed.map((entry) => ({
      ...scopeWhere(scope),
      date: parseLocalDateKey(entry.date),
      amount: entry.amount,
    })),
  });
  return parsed.length;
}

// Multi-product import (one sheet, many products). Rows reference products by
// their display name; names are resolved to ids so a rename never breaks the
// import file. The whole batch is rejected when any name is unknown.
export async function importSalesMany(
  userId: number,
  entries: unknown,
  client: SalesDb = db,
): Promise<number> {
  const parsed = assertRows(entries).map((entry) => {
    if (!isValidProductName(entry.productType)) {
      throw new ApiError(
        400,
        "INVALID_PRODUCT_TYPE",
        "each row needs a valid productType (1-40 chars, no whitespace)",
      );
    }
    return { productType: entry.productType, date: entry.date, amount: entry.amount };
  });

  const names = [...new Set(parsed.map((row) => row.productType))];
  const existing = await client.product.findMany({
    where: { userId, productType: { in: names } },
    select: { id: true, productType: true },
  });
  const byName = new Map(existing.map((row) => [row.productType, row.id]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new ApiError(
      400,
      "PRODUCT_NOT_FOUND",
      `请先在商品管理中创建:${missing.join("、")}`,
    );
  }

  const rows = parsed.map((row) => {
    const productId = byName.get(row.productType);
    if (productId === undefined) {
      throw new ApiError(
        400,
        "PRODUCT_NOT_FOUND",
        `请先在商品管理中创建:${row.productType}`,
      );
    }
    return {
      userId,
      productId,
      date: parseLocalDateKey(row.date),
      amount: row.amount,
    };
  });
  await client.importedSale.createMany({ data: rows });
  return parsed.length;
}

export async function removeImported(
  scope: Scope,
  id: number,
  client: SalesDb = db,
): Promise<void> {
  const result = await client.importedSale.deleteMany({
    where: { ...scopeWhere(scope), id },
  });
  if (result.count === 0) {
    throw new ApiError(404, "NOT_FOUND", "imported sale entry not found");
  }
}

export async function clearImported(scope: Scope, client: SalesDb = db): Promise<void> {
  await client.importedSale.deleteMany({ where: scopeWhere(scope) });
}

// Contiguous daily series from the earliest data day to today (both real
// orders and imported history), so sparse products still show their full
// timeline with zero-sale days.
export async function buildDailySalesSeries(
  scope: Scope,
  client: SalesDb = db,
): Promise<SalesDay[]> {
  const [sells, imported] = await Promise.all([
    client.scopeRecord.findMany({
      where: { ...scopeWhere(scope), kind: "SELL" },
      select: { amount: true, createdAt: true },
    }),
    client.importedSale.findMany({
      where: scopeWhere(scope),
      select: { amount: true, date: true },
    }),
  ]);

  const byKey = new Map<string, SalesDay>();
  const put = (date: Date, real: number, imported: number) => {
    const key = localDateKey(date);
    const day = byKey.get(key) ?? { date: key, real: 0, imported: 0, sale: 0 };
    day.real += real;
    day.imported += imported;
    day.sale = day.real + day.imported;
    byKey.set(key, day);
  };

  let earliest: Date | null = null;
  for (const sell of sells) {
    put(sell.createdAt, sell.amount, 0);
    if (!earliest || sell.createdAt < earliest) earliest = sell.createdAt;
  }
  for (const row of imported) {
    put(row.date, 0, row.amount);
    if (!earliest || row.date < earliest) earliest = row.date;
  }
  if (!earliest) return [];

  // earliest is a raw timestamp (a SELL createdAt can be mid-day); normalize
  // to its local midnight, or a same-day-only history would start after today
  // and produce an empty series.
  const firstDay = addLocalDays(earliest, 0);
  const todayStart = addLocalDays(new Date(), 0);
  const series: SalesDay[] = [];
  for (let day = firstDay; day <= todayStart; day = addLocalDays(day, 1)) {
    const key = localDateKey(day);
    series.push(byKey.get(key) ?? { date: key, real: 0, imported: 0, sale: 0 });
  }
  return series;
}
