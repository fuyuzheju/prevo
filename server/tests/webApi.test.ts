import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { truncateAll } from "./helpers.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve(undefined))),
  );
});

beforeEach(truncateAll);

async function call(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // 204 responses have no body
  }
  return { status: res.status, json };
}

async function registerAndLogin(username: string, password: string): Promise<string> {
  await call("POST", "/api/auth/register", { body: { username, password } });
  const { json } = await call("POST", "/api/auth/login", { body: { username, password } });
  return json.token;
}

// register + login + create a product; scope routes reject unknown products
async function loginWithProduct(username: string, productType = "widget"): Promise<string> {
  const token = await registerAndLogin(username, "secret123");
  const created = await call("POST", "/api/products", { token, body: { productType } });
  expect(created.status).toBe(201);
  return token;
}

const stateFields = [
  "cycle",
  "inventory",
  "soldTransit",
  "boughtTransit",
  "sent",
  "received",
  "sale",
  "purchase",
] as const;

function expectState(state: any, expected: Record<(typeof stateFields)[number], number>) {
  for (const key of stateFields) {
    expect(state[key], `field ${key}`).toBe(expected[key]);
  }
}

describe("health and 404", () => {
  it("answers /api/health", async () => {
    const res = await call("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
  });

  it("returns a JSON 404 for unknown endpoints", async () => {
    const res = await call("GET", "/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("NOT_FOUND");
  });
});

describe("auth endpoints", () => {
  it("registers, logs in and identifies", async () => {
    const registered = await call("POST", "/api/auth/register", {
      body: { username: "alice", password: "secret123" },
    });
    expect(registered.status).toBe(201);
    expect(registered.json.user.username).toBe("alice");
    expect(registered.json.user.passwordHash).toBeUndefined();

    const login = await call("POST", "/api/auth/login", {
      body: { username: "alice", password: "secret123" },
    });
    expect(login.status).toBe(200);
    expect(login.json.token).toBeTypeOf("string");

    const me = await call("GET", "/api/auth/me", { token: login.json.token });
    expect(me.status).toBe(200);
    expect(me.json.user.username).toBe("alice");
  });

  it("rejects duplicate registration and wrong credentials", async () => {
    await call("POST", "/api/auth/register", { body: { username: "alice", password: "secret123" } });
    const dup = await call("POST", "/api/auth/register", {
      body: { username: "alice", password: "secret123" },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("USERNAME_TAKEN");

    const wrong = await call("POST", "/api/auth/login", {
      body: { username: "alice", password: "wrong-pass" },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("requires a bearer token on protected routes", async () => {
    const res = await call("GET", "/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("UNAUTHORIZED");

    const state = await call("GET", "/api/products/widget/state");
    expect(state.status).toBe(401);
  });

  it("changes the password and removes the account", async () => {
    const token = await registerAndLogin("alice", "secret123");
    const changed = await call("PATCH", "/api/auth/password", {
      token,
      body: { oldPassword: "secret123", newPassword: "newpass456" },
    });
    expect(changed.status).toBe(204);
    const oldLogin = await call("POST", "/api/auth/login", {
      body: { username: "alice", password: "secret123" },
    });
    expect(oldLogin.status).toBe(401);

    const removed = await call("DELETE", "/api/auth/me", { token });
    expect(removed.status).toBe(204);
    const state = await call("GET", "/api/products/widget/state", { token });
    expect(state.status).toBe(401); // account gone => token no longer identifies
  });
});

describe("product management endpoints", () => {
  it("creates, lists, rejects duplicates and deletes products", async () => {
    const token = await registerAndLogin("alice", "secret123");

    const empty = await call("GET", "/api/products", { token });
    expect(empty.status).toBe(200);
    expect(empty.json.products).toEqual([]);

    const created = await call("POST", "/api/products", { token, body: { productType: "tee" } });
    expect(created.status).toBe(201);
    expect(created.json.product).toMatchObject({ productType: "tee" });
    expect(typeof created.json.product.createdAt).toBe("string");

    const duplicate = await call("POST", "/api/products", { token, body: { productType: "tee" } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.error.code).toBe("PRODUCT_EXISTS");

    const invalid = await call("POST", "/api/products", { token, body: { productType: "a b" } });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error.code).toBe("INVALID_PRODUCT_TYPE");

    const list = await call("GET", "/api/products", { token });
    expect(list.json.products.map((p: { productType: string }) => p.productType)).toEqual(["tee"]);

    const removed = await call("DELETE", "/api/products/tee", { token });
    expect(removed.status).toBe(204);
    const after = await call("GET", "/api/products", { token });
    expect(after.json.products).toEqual([]);
  });

  it("scope routes reject products that do not exist", async () => {
    const token = await loginWithProduct("alice", "widget");
    const missing = await call("GET", "/api/products/ghost/records", { token });
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe("PRODUCT_NOT_FOUND");

    const purchase = await call("POST", "/api/products/ghost/purchase", {
      token,
      body: { amount: 5 },
    });
    expect(purchase.status).toBe(404);
    expect(purchase.json.error.code).toBe("PRODUCT_NOT_FOUND");

    const deleted = await call("DELETE", "/api/products/ghost", { token });
    expect(deleted.status).toBe(404);
  });
});

describe("product cycle flow over HTTP", () => {
  it("runs a full cycle and exposes the snapshot", async () => {
    const token = await loginWithProduct("alice", "widget");

    const empty = await call("GET", "/api/products/widget/state", { token });
    expect(empty.status).toBe(404);
    expect(empty.json.error.code).toBe("NO_STATE");

    const purchase = await call("POST", "/api/products/widget/purchase", { token, body: { amount: 100 } });
    expect(purchase.json.ok).toBe(true);
    const invalidPurchase = await call("POST", "/api/products/widget/purchase", {
      token,
      body: { amount: -5 },
    });
    expect(invalidPurchase.json.ok).toBe(false);
    await call("POST", "/api/products/widget/sell", { token, body: { amount: 30 } });
    await call("POST", "/api/products/widget/receive", { token, body: { amount: 60 } });
    await call("POST", "/api/products/widget/send", { token, body: { amount: 20 } });
    const invalidSell = await call("POST", "/api/products/widget/sell", { token, body: { amount: 0 } });
    expect(invalidSell.status).toBe(400);
    expect(invalidSell.json.error.code).toBe("INVALID_AMOUNT");

    // pending ledger before settlement
    const pending = await call("GET", "/api/products/widget/records", { token });
    expect(pending.status).toBe(200);
    expect(pending.json.records).toHaveLength(4);
    for (const record of pending.json.records) expect(record.cycle).toBeNull();

    const summarized = await call("POST", "/api/products/widget/summarize", { token });
    expect(summarized.status).toBe(200);
    expectState(summarized.json.state, {
      cycle: 1,
      inventory: 40,
      soldTransit: 10,
      boughtTransit: 40,
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });

    // records are kept and now marked with cycle 1
    const settled = await call("GET", "/api/products/widget/records", { token });
    expect(settled.json.records).toHaveLength(4);
    for (const record of settled.json.records) expect(record.cycle).toBe(1);

    const state = await call("GET", "/api/products/widget/state", { token });
    expectState(state.json.state, {
      cycle: 1,
      inventory: 40,
      soldTransit: 10,
      boughtTransit: 40,
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });

    // second cycle depends on the first snapshot
    await call("POST", "/api/products/widget/purchase", { token, body: { amount: 50 } });
    await call("POST", "/api/products/widget/sell", { token, body: { amount: 80 } });
    const second = await call("POST", "/api/products/widget/summarize", { token });
    expectState(second.json.state, {
      cycle: 2,
      inventory: 40,
      soldTransit: 90,
      boughtTransit: 90,
      sent: 0,
      received: 0,
      sale: 80,
      purchase: 50,
    });

    const history = await call("GET", "/api/products/widget/states", { token });
    expect(history.json.states).toHaveLength(2);
    expect(history.json.states.map((s: { cycle: number }) => s.cycle)).toEqual([1, 2]);

    // settled records can never be folded twice
    const noop = await call("POST", "/api/products/widget/summarize", { token });
    expect(noop.json.state).toBeNull();
  });

  it("isolates scopes between productTypes and users", async () => {
    const token = await loginWithProduct("alice", "widget");
    const bobToken = await loginWithProduct("bob", "widget");
    await call("POST", "/api/products/widget/purchase", { token, body: { amount: 10 } });
    await call("POST", "/api/products/widget/summarize", { token });

    const gadget = await call("GET", "/api/products/gadget/state", { token });
    expect(gadget.status).toBe(404);
    expect(gadget.json.error.code).toBe("PRODUCT_NOT_FOUND");

    const bobWidget = await call("GET", "/api/products/widget/state", { token: bobToken });
    expect(bobWidget.status).toBe(404);
    expect(bobWidget.json.error.code).toBe("NO_STATE"); // bob has the product but no cycles
  });

  it("validates productType", async () => {
    const token = await loginWithProduct("alice", "widget");
    const res = await call("POST", `/api/products/${"x".repeat(65)}/purchase`, {
      token,
      body: { amount: 1 },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("INVALID_PRODUCT_TYPE");
  });
});
