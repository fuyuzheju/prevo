import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import { ApiError } from "../src/errors.js";
import {
  assertProduct,
  createProduct,
  listProducts,
  removeProduct,
  updateProduct,
} from "../src/modules/products.js";
import { advanceCycle, listStates } from "../src/modules/stateMachine.js";
import { createUser, mustDefined, scopeFor, truncateAll } from "./helpers.js";

async function createUserWithProduct(productType = "widget"): Promise<{ userId: number; productId: number }> {
  const userId = await createUser();
  const product = await createProduct(userId, productType);
  return { userId, productId: product.id };
}

describe("products", () => {
  beforeEach(truncateAll);

  it("lists products of a user with their ids", async () => {
    const { userId } = await createUserWithProduct("tee");
    await createProduct(userId, "shirt");
    const items = await listProducts(userId);
    expect(items.map((p) => p.productType)).toEqual(["tee", "shirt"]);
    const first = mustDefined(items[0], "first product");
    expect(first).toMatchObject({ productType: "tee", orderMultiple: 1 });
    expect(first.id).toBeTypeOf("number");
    expect(first.createdAt).toBeInstanceOf(Date);
  });

  it("isolates products between users", async () => {
    const { userId } = await createUserWithProduct();
    const other = await createUser();
    expect(await listProducts(other)).toEqual([]);
    expect(await listProducts(userId)).toHaveLength(1);
  });

  it("creates a product and rejects duplicates and invalid names", async () => {
    const userId = await createUser();
    const created = await createProduct(userId, "tee");
    expect(created).toMatchObject({ productType: "tee", orderMultiple: 1 });
    expect(created.id).toBeTypeOf("number");
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

  it("accepts and validates the orderMultiple on creation", async () => {
    const userId = await createUser();
    await expect(createProduct(userId, "tee", 5)).resolves.toMatchObject({
      productType: "tee",
      orderMultiple: 5,
    });
    for (const bad of [0, -2, 1.5, "10", null]) {
      await expect(createProduct(userId, "bad", bad)).rejects.toMatchObject({
        status: 400,
        code: "INVALID_ORDER_MULTIPLE",
      });
    }
  });

  it("patches attributes (name and orderMultiple) of an existing product", async () => {
    const { userId, productId } = await createUserWithProduct("tee");
    const renamed = await updateProduct(userId, productId, { productType: "tee2" });
    expect(renamed).toMatchObject({ productType: "tee2", orderMultiple: 1 });
    const updated = await updateProduct(userId, productId, { orderMultiple: 20 });
    expect(updated).toMatchObject({ productType: "tee2", orderMultiple: 20 });

    await expect(updateProduct(userId, productId, { productType: "a b" })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PRODUCT_TYPE",
    });
    await expect(updateProduct(userId, productId, { orderMultiple: 1.5 })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ORDER_MULTIPLE",
    });
    await expect(updateProduct(userId, productId, {})).rejects.toMatchObject({
      status: 400,
      code: "INVALID_BODY",
    });
    await expect(updateProduct(userId, 999999, { orderMultiple: 10 })).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
  });

  it("renaming keeps the id and its data, and rejects a duplicate name", async () => {
    const { userId, productId } = await createUserWithProduct("widget");
    await createProduct(userId, "other");
    const scope = scopeFor(userId, productId);
    await db.scopeRecord.create({ data: { ...scope, kind: "SELL", amount: 5 } });
    await advanceCycle(scope, { sent: 0, received: 0, sale: 10, purchase: 10 });

    await updateProduct(userId, productId, { productType: "renamed" });
    const items = await listProducts(userId);
    expect(items.map((p) => p.productType).sort()).toEqual(["other", "renamed"]);

    await expect(updateProduct(userId, productId, { productType: "other" })).rejects.toMatchObject({
      status: 409,
      code: "PRODUCT_EXISTS",
    });
    // data still belongs to the same product id after the rename
    expect(await db.scopeRecord.count({ where: { productId } })).toBe(1);
    expect((await listStates(scope))[0]?.cycle).toBe(1);
  });

  it("assertProduct guards unknown scopes", async () => {
    const { userId, productId } = await createUserWithProduct();
    await expect(assertProduct(scopeFor(userId, productId))).resolves.toBeUndefined();
    await expect(assertProduct(scopeFor(userId, 999999))).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
    const other = await createUser();
    await expect(assertProduct(scopeFor(other, productId))).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
  });

  it("removeProduct cleans its ledger, states and imports", async () => {
    const { userId, productId } = await createUserWithProduct();
    const scope = scopeFor(userId, productId);
    await db.scopeRecord.create({ data: { ...scope, kind: "SELL", amount: 5 } });
    await db.importedSale.create({ data: { ...scope, date: new Date(2026, 7, 1), amount: 9 } });
    await advanceCycle(scope, { sent: 0, received: 0, sale: 10, purchase: 10 });

    await removeProduct(userId, productId);

    expect(await db.product.count()).toBe(0);
    expect(await db.importedSale.count()).toBe(0);
    expect(await db.scopeRecord.count()).toBe(0);
    expect(await db.cycleState.count()).toBe(0);
  });

  it("removeProduct of an unknown product is a 404", async () => {
    const userId = await createUser();
    await expect(removeProduct(userId, 999999)).rejects.toBeInstanceOf(ApiError);
    await expect(removeProduct(userId, 999999)).rejects.toMatchObject({
      status: 404,
      code: "PRODUCT_NOT_FOUND",
    });
  });
});
