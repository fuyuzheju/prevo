import { db, type DbClient } from "../db.js";
import { ApiError, isPrismaUniqueViolation } from "../errors.js";
import { isValidProductName, type Scope } from "../../../shared/model.ts";
import type { Prisma } from "../../generated/prisma/client.js";

export interface ProductInfo {
  id: number;
  productType: string;
  orderMultiple: number;
  createdAt: Date;
}

export interface ProductPatch {
  productType?: unknown;
  orderMultiple?: unknown;
}

type ProductsDb = Pick<DbClient, "product" | "cycleState" | "scopeRecord" | "importedSale">;

const PRODUCT_SELECT = {
  id: true,
  productType: true,
  orderMultiple: true,
  createdAt: true,
} satisfies Prisma.ProductSelect;

// A fixed-point quantity as well (1/1000 units); 1 is the smallest value and
// doubles as "no constraint" when the suggestion is rounded to it.
function assertOrderMultiple(orderMultiple: unknown): number {
  if (typeof orderMultiple !== "number" || !Number.isSafeInteger(orderMultiple) || orderMultiple < 1) {
    throw new ApiError(
      400,
      "INVALID_ORDER_MULTIPLE",
      "orderMultiple must be a positive integer number of 1/1000 units",
    );
  }
  return orderMultiple;
}

export async function listProducts(userId: number, client: ProductsDb = db): Promise<ProductInfo[]> {
  return client.product.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: PRODUCT_SELECT,
  });
}

export async function createProduct(
  userId: number,
  productType: unknown,
  orderMultiple?: unknown,
  client: ProductsDb = db,
): Promise<ProductInfo> {
  if (!isValidProductName(productType)) {
    throw new ApiError(
      400,
      "INVALID_PRODUCT_TYPE",
      "productType must be 1-40 characters without whitespace",
    );
  }
  const multiple = orderMultiple === undefined ? 1 : assertOrderMultiple(orderMultiple);
  try {
    return await client.product.create({
      data: { userId, productType, orderMultiple: multiple },
      select: PRODUCT_SELECT,
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new ApiError(409, "PRODUCT_EXISTS", "this product already exists");
    }
    throw error;
  }
}

// Partial attribute update (currently: display name and orderMultiple).
// Renaming only touches this row because every scope references productId.
export async function updateProduct(
  userId: number,
  productId: number,
  patch: ProductPatch,
  client: ProductsDb = db,
): Promise<ProductInfo> {
  if (patch.productType === undefined && patch.orderMultiple === undefined) {
    throw new ApiError(400, "INVALID_BODY", "no product attributes to update");
  }
  const existing = await client.product.findUnique({
    where: { id: productId },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== userId) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "this product does not exist");
  }
  const data: { productType?: string; orderMultiple?: number } = {};
  if (patch.productType !== undefined) {
    if (!isValidProductName(patch.productType)) {
      throw new ApiError(
        400,
        "INVALID_PRODUCT_TYPE",
        "productType must be 1-40 characters without whitespace",
      );
    }
    data.productType = patch.productType;
  }
  if (patch.orderMultiple !== undefined) {
    data.orderMultiple = assertOrderMultiple(patch.orderMultiple);
  }
  try {
    return await client.product.update({
      where: { id: productId },
      data,
      select: PRODUCT_SELECT,
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new ApiError(409, "PRODUCT_EXISTS", "another product already has this name");
    }
    throw error;
  }
}

// Throws when the scope has no product; every scope-facing API is guarded by
// this so records/states can never be written for a non-existent product.
export async function assertProduct(scope: Scope, client: ProductsDb = db): Promise<void> {
  const found = await client.product.findUnique({
    where: { id: scope.productId },
    select: { id: true, userId: true },
  });
  if (!found || found.userId !== scope.userId) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "this product does not exist");
  }
}

// Removes the product together with its ledger, state history and imports.
export async function removeProduct(
  userId: number,
  productId: number,
  client: ProductsDb = db,
): Promise<void> {
  const scope: Scope = { userId, productId };
  await assertProduct(scope, client);
  await client.scopeRecord.deleteMany({ where: { userId, productId } });
  await client.cycleState.deleteMany({ where: { userId, productId } });
  await client.importedSale.deleteMany({ where: { userId, productId } });
  await client.product.delete({ where: { id: productId } });
}
