import { Router, type Request, type RequestHandler } from "express";
import { ApiError } from "../errors.js";
import { isQuantity, type Scope } from "../../../shared/model.ts";
import * as userSystem from "./userSystem.js";
import * as stateMachine from "./stateMachine.js";
import * as stateSummary from "./stateSummary.js";
import * as productModule from "./products.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: userSystem.AuthUser;
    }
  }
}

// --- auth ---

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
  res.json({ user: req.authUser });
});

authRouter.patch("/password", requireAuth, async (req, res) => {
  await userSystem.changePassword(
    req.authUser!.id,
    bodyString(req, "oldPassword"),
    bodyString(req, "newPassword"),
  );
  res.status(204).end();
});

authRouter.delete("/me", requireAuth, async (req, res) => {
  await userSystem.removeUser(req.authUser!.id);
  res.status(204).end();
});

// --- product-scoped records & states ---

export const productsRouter: Router = Router();
productsRouter.use(requireAuth);

function scopeOf(req: Request): Scope {
  const { productType } = req.params;
  if (typeof productType !== "string" || productType.length === 0 || productType.length > 64) {
    throw new ApiError(400, "INVALID_PRODUCT_TYPE", "productType must be 1-64 characters");
  }
  return { userId: req.authUser!.id, productType };
}

function amountOf(req: Request): number {
  const amount = req.body?.amount;
  if (!isQuantity(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amount must be a positive integer");
  }
  return amount;
}

// Every scope-facing route requires the product to exist.
async function requireProduct(req: Request) {
  await productModule.assertProduct(scopeOf(req));
}

// collection routes (must be registered before the :productType routes)
productsRouter.get("/", async (req, res) => {
  const items = await productModule.listProducts(req.authUser!.id);
  res.json({ products: items });
});

productsRouter.post("/", async (req, res) => {
  const product = await productModule.createProduct(
    req.authUser!.id,
    (req.body as Record<string, unknown> | undefined)?.productType,
  );
  res.status(201).json({ product });
});

productsRouter.delete("/:productType", async (req, res) => {
  await productModule.removeProduct(req.authUser!.id, scopeOf(req).productType);
  res.status(204).end();
});

// scope routes
productsRouter.get("/:productType/state", async (req, res) => {
  await requireProduct(req);
  const snapshot = await stateMachine.getLatestState(scopeOf(req));
  if (!snapshot) {
    throw new ApiError(404, "NO_STATE", "this scope has no cycle state yet");
  }
  res.json({ state: snapshot });
});

productsRouter.get("/:productType/states", async (req, res) => {
  await requireProduct(req);
  const states = await stateMachine.listStates(scopeOf(req));
  res.json({ states });
});

productsRouter.get("/:productType/records", async (req, res) => {
  await requireProduct(req);
  const records = await stateSummary.listRecords(scopeOf(req));
  res.json({ records });
});

productsRouter.post("/:productType/purchase", async (req, res) => {
  await requireProduct(req);
  const scope = scopeOf(req);
  const ok = await stateSummary.purchase(scope, req.body?.amount);
  res.json({ ok });
});

productsRouter.post("/:productType/sell", async (req, res) => {
  await requireProduct(req);
  const scope = scopeOf(req);
  await stateSummary.sell(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productType/send", async (req, res) => {
  await requireProduct(req);
  const scope = scopeOf(req);
  await stateSummary.send(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productType/receive", async (req, res) => {
  await requireProduct(req);
  const scope = scopeOf(req);
  await stateSummary.receive(scope, amountOf(req));
  res.status(204).end();
});

productsRouter.post("/:productType/summarize", async (req, res) => {
  await requireProduct(req);
  const state = await stateSummary.summarize(scopeOf(req));
  res.json({ state });
});

// --- helpers ---

function bodyString(req: Request, key: string): string {
  const body: unknown = req.body;
  const value = (body as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_BODY", `missing or invalid string field "${key}"`);
  }
  return value;
}
