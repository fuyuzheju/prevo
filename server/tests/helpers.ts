import { db } from "../src/db.js";
import type { Scope } from "../../shared/model.ts";

let userCounter = 0;

export async function truncateAll(): Promise<void> {
  await db.scopeRecord.deleteMany();
  await db.cycleState.deleteMany();
  await db.importedSale.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

export async function createUser(
  username = `test-user-${Date.now()}-${userCounter++}`,
): Promise<number> {
  const user = await db.user.create({ data: { username, passwordHash: "unused" } });
  return user.id;
}

export function scopeFor(userId: number, productId: number): Scope {
  return { userId, productId };
}

// Creates a product row and returns its id.
export async function createProduct(
  userId: number,
  productType = "widget",
  orderMultiple = 1,
): Promise<number> {
  const product = await db.product.create({ data: { userId, productType, orderMultiple } });
  return product.id;
}

export async function createScope(productType = "widget"): Promise<Scope> {
  const userId = await createUser();
  const productId = await createProduct(userId, productType);
  return scopeFor(userId, productId);
}

// Tests often read index positions that the DB contract guarantees to exist;
// this fails loudly instead of using a non-null assertion.
export function mustDefined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be defined`);
  }
  return value;
}
