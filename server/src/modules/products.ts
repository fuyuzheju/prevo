import { db, type DbClient } from "../db.js";
import { ApiError } from "../errors.js";
import { isValidProductName, type Scope } from "../../../shared/model.ts";

export interface ProductInfo {
  productType: string;
  createdAt: Date;
}

type ProductsDb = Pick<DbClient, "product" | "cycleState" | "scopeRecord">;

function productWhere(scope: Scope) {
  return { userId: scope.userId, productType: scope.productType };
}

export async function listProducts(userId: number, client: ProductsDb = db): Promise<ProductInfo[]> {
  const rows = await client.product.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { productType: true, createdAt: true },
  });
  return rows;
}

export async function createProduct(
  userId: number,
  productType: unknown,
  client: ProductsDb = db,
): Promise<ProductInfo> {
  if (!isValidProductName(productType)) {
    throw new ApiError(
      400,
      "INVALID_PRODUCT_TYPE",
      "productType must be 1-40 characters without whitespace",
    );
  }
  try {
    const row = await client.product.create({
      data: { userId, productType },
      select: { productType: true, createdAt: true },
    });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "PRODUCT_EXISTS", "this product already exists");
    }
    throw error;
  }
}

// Throws when the scope has no product; every scope-facing API is guarded by
// this so records/states can never be written for a non-existent product.
export async function assertProduct(scope: Scope, client: ProductsDb = db): Promise<void> {
  const found = await client.product.findUnique({
    where: { userId_productType: productWhere(scope) },
    select: { id: true },
  });
  if (!found) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "this product does not exist");
  }
}

// Removes the product together with its whole ledger and state history.
export async function removeProduct(
  userId: number,
  productType: string,
  client: ProductsDb = db,
): Promise<void> {
  const scope: Scope = { userId, productType };
  await assertProduct(scope, client);
  await client.scopeRecord.deleteMany({ where: productWhere(scope) });
  await client.cycleState.deleteMany({ where: productWhere(scope) });
  await client.product.delete({ where: { userId_productType: productWhere(scope) } });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
