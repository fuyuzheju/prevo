import { db } from "../src/db.js";
import type { Scope } from "../../shared/model.ts";

let userCounter = 0;

export async function truncateAll(): Promise<void> {
  await db.scopeRecord.deleteMany();
  await db.cycleState.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

export async function createUser(
  username = `test-user-${Date.now()}-${userCounter++}`,
): Promise<number> {
  const user = await db.user.create({ data: { username, passwordHash: "unused" } });
  return user.id;
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
