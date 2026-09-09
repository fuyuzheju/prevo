import type {
  ImportedSaleItem,
  ProductItem,
  RecordEntry,
  RecordKind,
  SalesDay,
  SalesPrediction,
  StateSnapshot,
} from "./types.ts";
import { isRecordKind } from "../../../shared/model.ts";
import { getToken } from "./storage.ts";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let unauthorizedHandler: () => void = () => {};

// The auth provider registers here so that any 401 (expired token, deleted
// account) ends the session.
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

interface RawResponse {
  status: number;
  data: unknown; // parsed JSON body, or undefined for 204
}

async function send(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  const { method = "GET", body } = options;
  let response: Response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "无法连接服务器，请稍后再试");
  }
  if (response.status === 204) {
    return { status: response.status, data: undefined };
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // keep data null for non-JSON responses
  }
  if (!response.ok) {
    const record = recordOf(data);
    const errorRecord = record !== null ? recordOf(record["error"]) : null;
    if (response.status === 401) unauthorizedHandler();
    throw new ApiError(
      response.status,
      errorRecord !== null && typeof errorRecord["code"] === "string" ? errorRecord["code"] : "UNKNOWN",
      errorRecord !== null && typeof errorRecord["message"] === "string"
        ? errorRecord["message"]
        : `请求失败 (${response.status})`,
    );
  }
  return { status: response.status, data };
}

// --- runtime decoding helpers: the server payload is only trusted at this
// boundary, every response field is narrowed before it is used ---

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function badResponse(): never {
  throw new ApiError(502, "BAD_RESPONSE", "服务器返回了无法识别的数据");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") badResponse();
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") badResponse();
  return value;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const inner = recordOf(record[key]);
  if (inner === null) badResponse();
  return inner;
}

function itemField<T>(value: unknown, decode: (record: Record<string, unknown>) => T): T {
  const record = recordOf(value);
  if (record === null) badResponse();
  return decode(record);
}

function decodeStateSnapshot(record: Record<string, unknown>): StateSnapshot {
  return {
    cycle: numberField(record, "cycle"),
    inventory: numberField(record, "inventory"),
    soldTransit: numberField(record, "soldTransit"),
    boughtTransit: numberField(record, "boughtTransit"),
    sent: numberField(record, "sent"),
    received: numberField(record, "received"),
    sale: numberField(record, "sale"),
    purchase: numberField(record, "purchase"),
  };
}

function decodeProductItem(record: Record<string, unknown>): ProductItem {
  return { productType: stringField(record, "productType"), createdAt: stringField(record, "createdAt") };
}

function decodeRecordEntry(record: Record<string, unknown>): RecordEntry {
  const kind = stringField(record, "kind");
  if (!isRecordKind(kind)) badResponse();
  const cycle = record["cycle"];
  if (cycle !== null && typeof cycle !== "number") badResponse();
  return {
    id: numberField(record, "id"),
    kind,
    amount: numberField(record, "amount"),
    cycle,
    createdAt: stringField(record, "createdAt"),
  };
}

function decodeSalesDay(record: Record<string, unknown>): SalesDay {
  return {
    date: stringField(record, "date"),
    real: numberField(record, "real"),
    imported: numberField(record, "imported"),
    sale: numberField(record, "sale"),
  };
}

function decodeImportedSale(record: Record<string, unknown>): ImportedSaleItem {
  return {
    id: numberField(record, "id"),
    date: stringField(record, "date"),
    amount: numberField(record, "amount"),
  };
}

function productPath(productType: string, suffix = ""): string {
  return `/products/${encodeURIComponent(productType)}${suffix}`;
}

// --- auth ---

export async function register(username: string, password: string): Promise<void> {
  await send("/auth/register", { method: "POST", body: { username, password } });
}

export async function login(username: string, password: string): Promise<string> {
  const { data } = await send("/auth/login", { method: "POST", body: { username, password } });
  const record = recordOf(data);
  if (record === null) badResponse();
  return stringField(record, "token");
}

export async function me(): Promise<{ id: number; username: string; createdAt: string }> {
  const { data } = await send("/auth/me");
  const record = recordOf(data);
  if (record === null) badResponse();
  const user = recordField(record, "user");
  return {
    id: numberField(user, "id"),
    username: stringField(user, "username"),
    createdAt: stringField(user, "createdAt"),
  };
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await send("/auth/password", { method: "PATCH", body: { oldPassword, newPassword } });
}

export async function deleteAccount(): Promise<void> {
  await send("/auth/me", { method: "DELETE" });
}

// --- products ---

export async function listProducts(): Promise<ProductItem[]> {
  const { data } = await send("/products");
  const record = recordOf(data);
  if (record === null) badResponse();
  const list = record["products"];
  if (!Array.isArray(list)) badResponse();
  return list.map((item) => itemField(item, decodeProductItem));
}

export async function createProduct(productType: string): Promise<ProductItem> {
  const { data } = await send("/products", { method: "POST", body: { productType } });
  const record = recordOf(data);
  if (record === null) badResponse();
  return decodeProductItem(recordField(record, "product"));
}

export async function deleteProduct(productType: string): Promise<void> {
  await send(productPath(productType), { method: "DELETE" });
}

// --- product data ---

const NO_STATE = "NO_STATE";

// null when the scope has no cycle state yet (404 NO_STATE).
export async function getLatestState(productType: string): Promise<StateSnapshot | null> {
  try {
    const { data } = await send(productPath(productType, "/state"));
    const record = recordOf(data);
    if (record === null) badResponse();
    return decodeStateSnapshot(recordField(record, "state"));
  } catch (error) {
    if (error instanceof ApiError && error.code === NO_STATE) return null;
    throw error;
  }
}

export async function listRecords(productType: string): Promise<RecordEntry[]> {
  const { data } = await send(productPath(productType, "/records"));
  const record = recordOf(data);
  if (record === null) badResponse();
  const list = record["records"];
  if (!Array.isArray(list)) badResponse();
  return list.map((item) => itemField(item, decodeRecordEntry));
}

// purchase resolves to false instead of erroring on an invalid amount
export async function addRecord(
  productType: string,
  kind: RecordKind,
  amount: number,
): Promise<boolean> {
  const body = { amount };
  if (kind === "PURCHASE") {
    const { data } = await send(productPath(productType, "/purchase"), { method: "POST", body });
    const record = recordOf(data);
    if (record === null) badResponse();
    const ok = record["ok"];
    if (typeof ok !== "boolean") badResponse();
    return ok;
  }
  const suffix = `/${kind.toLowerCase()}`;
  await send(productPath(productType, suffix), { method: "POST", body });
  return true;
}

// --- sales prediction ---

export async function getPrediction(productType: string): Promise<SalesPrediction> {
  const { data } = await send(productPath(productType, "/predict"));
  const record = recordOf(data);
  if (record === null) badResponse();
  const seriesValue = record["series"];
  if (!Array.isArray(seriesValue)) badResponse();
  const forecast = recordField(record, "forecast");
  return {
    productType: stringField(record, "productType"),
    series: seriesValue.map((item) => itemField(item, decodeSalesDay)),
    importedCount: numberField(record, "importedCount"),
    available: numberField(record, "available"),
    safetyStock: numberField(record, "safetyStock"),
    suggestedAmount: numberField(record, "suggestedAmount"),
    forecast: {
      windowDays: numberField(forecast, "windowDays"),
      dailyRate: numberField(forecast, "dailyRate"),
      method: stringField(forecast, "method"),
    },
  };
}

// multi-product historical sales import (long table rows)
export async function importSalesMany(
  entries: { productType: string; date: string; amount: number }[],
): Promise<number> {
  const { data } = await send("/sales/import", { method: "POST", body: { entries } });
  const record = recordOf(data);
  if (record === null) badResponse();
  return numberField(record, "imported");
}

export async function listImportedSales(productType: string): Promise<ImportedSaleItem[]> {
  const { data } = await send(productPath(productType, "/sales/import"));
  const record = recordOf(data);
  if (record === null) badResponse();
  const list = record["entries"];
  if (!Array.isArray(list)) badResponse();
  return list.map((item) => itemField(item, decodeImportedSale));
}

export async function deleteImportedSale(productType: string, id: number): Promise<void> {
  await send(productPath(productType, `/sales/import/${id}`), { method: "DELETE" });
}

export async function clearImportedSales(productType: string): Promise<void> {
  await send(productPath(productType, "/sales/import"), { method: "DELETE" });
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "发生未知错误";
}
