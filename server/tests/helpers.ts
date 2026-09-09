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

// Tests often read index positions that the DB contract guarantees to exist;
// this fails loudly instead of using a non-null assertion.
export function mustDefined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be defined`);
  }
  return value;
}

export function scopeFor(userId: number, productType = "widget"): Scope {
  return { userId, productType };
}

export async function createProduct(
  userId: number,
  productType = "widget",
): Promise<void> {
  await db.product.create({ data: { userId, productType } });
}

export async function createScope(productType = "widget"): Promise<Scope> {
  const userId = await createUser();
  await createProduct(userId, productType);
  return scopeFor(userId, productType);
}
