import express, { type ErrorRequestHandler } from "express";
import { ApiError } from "./errors.js";
import { authRouter, productsRouter } from "./modules/webApi.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/products", productsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "no such endpoint" } });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (isPrismaUniqueViolation(error)) {
      res.status(409).json({ error: { code: "CONFLICT", message: "conflicts with existing data" } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: "INTERNAL", message: "internal server error" } });
  };
  app.use(errorHandler);

  return app;
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
