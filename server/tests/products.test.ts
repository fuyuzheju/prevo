import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import { ApiError } from "../src/errors.js";
import {
  assertProduct,
  createProduct,
  listProducts,
  removeProduct,
} from "../src/modules/products.js";
import { advanceCycle } from "../src/modules/stateMachine.js";
import { createUser, mustDefined, scopeFor, truncateAll } from "./helpers.js";

async function createUserWithProduct(productType = "widget"): Promise<number> {
  const userId = await createUser();
  await createProduct(userId, productType);
  return userId;
}

describe("products", () => {
  beforeEach(truncateAll);

  it("lists products of a user", async () => {
    const userId = await createUserWithProduct("tee");
    await createProduct(userId, "shirt");
    const items = await listProducts(userId);
    expect(items.map((p) => p.productType)).toEqual(["tee", "shirt"]);
    expect(mustDefined(items[0], "first product")).toMatchObject({ productType: "tee" });
    expect(mustDefined(items[0], "first product").createdAt).toBeInstanceOf(Date);
  });

  it("isolates products between users", async () => {
    const userId = await createUserWithProduct();
    const other = await createUser();
    expect(await listProducts(other)).toEqual([]);
    expect(await listProducts(userId)).toHaveLength(1);
  });

  it("creates a product and rejects duplicates and invalid names", async () => {
    const userId = await createUser();
    await expect(createProduct(userId, "tee")).resolves.toMatchObject({ productType: "tee" });
    await expect(createProduct(userId, "tee")).rejects.toMatchObject({
      status: 409,
      code: "PRODUCT_EXISTS",
    });
    for (const bad of ["", "a b", " tee", 42, "a".repeat(41), null]) {
      await expect(createProduct(userId, bad)).rejects.toMatchObject({
        status: 400,
        code: "INVALID_PRODUCT_TYPE",
      });
    }
  });

  it("assertProduct guards unknown scopes", async () => {
    const userId = await createUserWithProduct();
    await expect(assertProduct(scopeFor(userId, "widget"))).resolves.toBeUndefined();
    await expect(assertProduct(scopeFor(userId, "nope"))).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
    await expect(assertProduct(scopeFor(await createUser(), "widget"))).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
  });

  it("removeProduct cleans its ledger, states and imports", async () => {
    const userId = await createUserWithProduct();
    const scope = scopeFor(userId, "widget");
    await db.scopeRecord.create({ data: { ...scope, kind: "SELL", amount: 5 } });
    await db.importedSale.create({ data: { ...scope, date: new Date(2026, 7, 1), amount: 9 } });
    await advanceCycle(scope, { sent: 0, received: 0, sale: 10, purchase: 10 });

    await removeProduct(userId, "widget");

    expect(await db.product.count()).toBe(0);
    expect(await db.importedSale.count()).toBe(0);
    expect(await db.scopeRecord.count()).toBe(0);
    expect(await db.cycleState.count()).toBe(0);
  });

  it("removeProduct of an unknown product is a 404", async () => {
    const userId = await createUser();
    await expect(removeProduct(userId, "ghost")).rejects.toBeInstanceOf(ApiError);
    await expect(removeProduct(userId, "ghost")).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
  });
});
