import type { ProductItem, RecordEntry, RecordKind, StateSnapshot } from "./types.ts";
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    return undefined as T;
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // keep data null for non-JSON responses
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    if (response.status === 401) unauthorizedHandler();
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `请求失败 (${response.status})`,
    );
  }
  return data as T;
}

function productPath(productType: string, suffix = ""): string {
  return `/products/${encodeURIComponent(productType)}${suffix}`;
}

// --- auth ---

export async function register(username: string, password: string): Promise<void> {
  await request("/auth/register", { method: "POST", body: { username, password } });
}

export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ token: string }>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  return data.token;
}

export async function me(): Promise<{ id: number; username: string; createdAt: string }> {
  const data = await request<{ user: { id: number; username: string; createdAt: string } }>("/auth/me");
  return data.user;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await request("/auth/password", {
    method: "PATCH",
    body: { oldPassword, newPassword },
  });
}

export async function deleteAccount(): Promise<void> {
  await request("/auth/me", { method: "DELETE" });
}

// --- products ---

export async function listProducts(): Promise<ProductItem[]> {
  const data = await request<{ products: ProductItem[] }>("/products");
  return data.products;
}

export async function createProduct(productType: string): Promise<ProductItem> {
  const data = await request<{ product: ProductItem }>("/products", {
    method: "POST",
    body: { productType },
  });
  return data.product;
}

export async function deleteProduct(productType: string): Promise<void> {
  await request(productPath(productType), { method: "DELETE" });
}

// --- product data ---

const NO_STATE = "NO_STATE";

// null when the scope has no cycle state yet (404 NO_STATE).
export async function getLatestState(productType: string): Promise<StateSnapshot | null> {
  try {
    const data = await request<{ state: StateSnapshot }>(productPath(productType, "/state"));
    return data.state;
  } catch (error) {
    if (error instanceof ApiError && error.code === NO_STATE) return null;
    throw error;
  }
}

export async function listRecords(productType: string): Promise<RecordEntry[]> {
  const data = await request<{ records: RecordEntry[] }>(productPath(productType, "/records"));
  return data.records;
}

// purchase resolves to false instead of erroring on an invalid amount
export async function addRecord(
  productType: string,
  kind: RecordKind,
  amount: number,
): Promise<boolean> {
  const body = { amount };
  if (kind === "PURCHASE") {
    const data = await request<{ ok: boolean }>(productPath(productType, "/purchase"), {
      method: "POST",
      body,
    });
    return data.ok;
  }
  const suffix = `/${kind.toLowerCase()}`;
  await request(productPath(productType, suffix), { method: "POST", body });
  return true;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "发生未知错误";
}
