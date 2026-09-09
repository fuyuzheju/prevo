import { Router, type Request, type RequestHandler } from "express";
import { db } from "../db.js";
import { ApiError } from "../errors.js";
import { isQuantity, type Scope } from "../../../shared/model.ts";
import * as userSystem from "./userSystem.js";
import * as stateMachine from "./stateMachine.js";
import * as stateSummary from "./stateSummary.js";
import * as productModule from "./products.js";
import * as salesHistory from "./salesHistory.js";
import { decidePurchase } from "./decision.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: userSystem.AuthUser;
    }
  }
}

// --- auth ---

// requireAuth stores the identity on the request; every route that reads it
// runs behind requireAuth, so this only throws for coding mistakes.
function authUserOf(req: Request) {
  const user = req.authUser;
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "missing bearer token");
  }
  return user;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "missing bearer token");
  }
  req.authUser = await userSystem.identify(token);
  next();
};

export const authRouter: Router = Router();

authRouter.post("/register", async (req, res) => {
  const user = await userSystem.register(bodyString(req, "username"), bodyString(req, "password"));
  res.status(201).json({ user });
});

authRouter.post("/login", async (req, res) => {
  const token = await userSystem.login(bodyString(req, "username"), bodyString(req, "password"));
  res.json({ token });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: authUserOf(req) });
});

authRouter.patch("/password", requireAuth, async (req, res) => {
  const user = authUserOf(req);
  await userSystem.changePassword(
    user.id,
    bodyString(req, "oldPassword"),
    bodyString(req, "newPassword"),
  );
  res.status(204).end();
});

authRouter.delete("/me", requireAuth, async (req, res) => {
  await userSystem.removeUser(authUserOf(req).id);
  res.status(204).end();
});

// --- product-scoped records & states ---

export const productsRouter: Router = Router();
productsRouter.use(requireAuth);

function productScopeOf(req: Request): Scope {
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId < 1) {
    throw new ApiError(400, "INVALID_PRODUCT_ID", "productId must be a positive integer");
  }
  return { userId: authUserOf(req).id, productId };
}

function amountOf(req: Request): number {
  const amount = bodyValue(req, "amount");
  if (!isQuantity(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amount must be a positive integer");
  }
  return amount;
}

// Every scope-facing route requires the product to exist.
async function requireProduct(req: Request) {
  await productModule.assertProduct(productScopeOf(req));
}

// collection routes (must be registered before the :productId routes)
productsRouter.get("/", async (req, res) => {
  const items = await productModule.listProducts(authUserOf(req).id);
  res.json({ products: items });
});

productsRouter.post("/", async (req, res) => {
  const product = await productModule.createProduct(
    authUserOf(req).id,
    bodyValue(req, "productType"),
    bodyValue(req, "orderMultiple"),
  );
  res.status(201).json({ product });
});

productsRouter.patch("/:productId", async (req, res) => {
  const scope = productScopeOf(req);
  const product = await productModule.updateProduct(scope.userId, scope.productId, {
    productType: bodyValue(req, "productType"),
    orderMultiple: bodyValue(req, "orderMultiple"),
  });
  res.json({ product });
});

productsRouter.delete("/:productId", async (req, res) => {
  const scope = productScopeOf(req);
  await productModule.removeProduct(scope.userId, scope.productId);
  res.status(204).end();
});

// multi-product sales-history import (long table: one product per row)
export const salesRouter: Router = Router();
salesRouter.use(requireAuth);
salesRouter.post("/import", async (req, res) => {
  const imported = await salesHistory.importSalesMany(
    authUserOf(req).id,
    bodyValue(req, "entries"),
  );
  res.status(201).json({ imported });
});

// scope routes
productsRouter.get("/:productId/state", async (req, res) => {
  await requireProduct(req);
  const snapshot = await stateMachine.getLatestState(productScopeOf(req));
  if (!snapshot) {
    throw new ApiError(404, "NO_STATE", "this scope has no cycle state yet");
  }
  res.json({ state: snapshot });
});

productsRouter.get("/:productId/states", async (req, res) => {
  await requireProduct(req);
  const states = await stateMachine.listStates(productScopeOf(req));
  res.json({ states });
});

productsRouter.get("/:productId/records", async (req, res) => {
  await requireProduct(req);
  const records = await stateSummary.listRecords(productScopeOf(req));
  res.json({ records });
});

// --- prediction & imported sales history ---

productsRouter.get("/:productId/predict", async (req, res) => {
  await requireProduct(req);
  const scope = productScopeOf(req);
  const { series, available, safetyStock, suggestedAmount, orderMultiple, forecast } =
    await decidePurchase(scope);
  const [imported, product] = await Promise.all([
    salesHistory.listImported(scope),
    db.product.findUnique({ where: { id: scope.productId }, select: { productType: true } }),
  ]);
  if (product === null) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "this product does not exist");
  }
  res.json({
    productType: product.productType,
    series,
    importedCount: imported.length,
    available,
    safetyStock,
    suggestedAmount,
    orderMultiple,
    forecast,
  });
});

productsRouter.post("/:productId/sales/import", async (req, res) => {
  await requireProduct(req);
  const imported = await salesHistory.importSales(productScopeOf(req), bodyValue(req, "entries"));
  res.status(201).json({ imported });
});

productsRouter.get("/:productId/sales/import", async (req, res) => {
  await requireProduct(req);
  const entries = await salesHistory.listImported(productScopeOf(req));
  res.json({ entries });
});

productsRouter.delete("/:productId/sales/import/:id", async (req, res) => {
  await requireProduct(req);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    throw new ApiError(400, "INVALID_ID", "invalid imported sale id");
  }
  await salesHistory.removeImported(productScopeOf(req), id);
  res.status(204).end();
});

productsRouter.delete("/:productId/sales/import", async (req, res) => {
  await requireProduct(req);
  await salesHistory.clearImported(productScopeOf(req));
  res.status(204).end();
});

productsRouter.post("/:productId/purchase", async (req, res) => {
  await requireProduct(req);
  const scope = productScopeOf(req);
  const amount = bodyValue(req, "amount");
  const ok = await stateSummary.purchase(scope, isQuantity(amount) ? amount : 0);
  res.json({ ok });
});

productsRouter.post("/:productId/sell", async (req, res) => {
  await requireProduct(req);
  const scope = productScopeOf(req);
  await stateSummary.sell(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productId/send", async (req, res) => {
  await requireProduct(req);
  const scope = productScopeOf(req);
  await stateSummary.send(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productId/receive", async (req, res) => {
  await requireProduct(req);
  const scope = productScopeOf(req);
  await stateSummary.receive(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productId/summarize", async (req, res) => {
  await requireProduct(req);
  const state = await stateSummary.summarize(productScopeOf(req));
  res.json({ state });
});

// --- helpers ---

// The express body is unknown at runtime; JSON bodies arrive as objects and
// everything else is rejected by these readers.
function bodyValue(req: Request, key: string): unknown {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_BODY", "request body must be a JSON object");
  }
  return Object.fromEntries(Object.entries(body))[key];
}

function bodyString(req: Request, key: string): string {
  const value = bodyValue(req, key);
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BODY", `missing or invalid string field "${key}"`);
  }
  return value;
}
