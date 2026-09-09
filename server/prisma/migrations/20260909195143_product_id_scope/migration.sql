-- Scope identity moves from (userId, productType) to (userId, productId).
-- SQLite cannot alter columns in place, so each scope table is rebuilt and
-- backfilled by joining Product on (userId, productType).

-- CycleState
CREATE TABLE "new_CycleState" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "cycle" INTEGER NOT NULL,
  "inventory" INTEGER NOT NULL,
  "soldTransit" INTEGER NOT NULL,
  "boughtTransit" INTEGER NOT NULL,
  "sent" INTEGER NOT NULL,
  "received" INTEGER NOT NULL,
  "sale" INTEGER NOT NULL,
  "purchase" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CycleState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CycleState_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CycleState" (
  "id", "userId", "productId", "cycle", "inventory", "soldTransit", "boughtTransit",
  "sent", "received", "sale", "purchase", "createdAt"
)
SELECT
  c."id", c."userId", p."id", c."cycle", c."inventory", c."soldTransit", c."boughtTransit",
  c."sent", c."received", c."sale", c."purchase", c."createdAt"
FROM "CycleState" c
JOIN "Product" p ON p."userId" = c."userId" AND p."productType" = c."productType";
DROP TABLE "CycleState";
ALTER TABLE "new_CycleState" RENAME TO "CycleState";
CREATE UNIQUE INDEX "CycleState_productId_cycle_key" ON "CycleState" ("productId", "cycle");
CREATE INDEX "CycleState_productId_idx" ON "CycleState" ("productId");

-- ScopeRecord
CREATE TABLE "new_ScopeRecord" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "cycle" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScopeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScopeRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScopeRecord" ("id", "userId", "productId", "kind", "amount", "cycle", "createdAt")
SELECT c."id", c."userId", p."id", c."kind", c."amount", c."cycle", c."createdAt"
FROM "ScopeRecord" c
JOIN "Product" p ON p."userId" = c."userId" AND p."productType" = c."productType";
DROP TABLE "ScopeRecord";
ALTER TABLE "new_ScopeRecord" RENAME TO "ScopeRecord";
CREATE INDEX "ScopeRecord_productId_idx" ON "ScopeRecord" ("productId");

-- ImportedSale
CREATE TABLE "new_ImportedSale" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "date" DATETIME NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportedSale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImportedSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportedSale" ("id", "userId", "productId", "date", "amount", "createdAt")
SELECT c."id", c."userId", p."id", c."date", c."amount", c."createdAt"
FROM "ImportedSale" c
JOIN "Product" p ON p."userId" = c."userId" AND p."productType" = c."productType";
DROP TABLE "ImportedSale";
ALTER TABLE "new_ImportedSale" RENAME TO "ImportedSale";
CREATE INDEX "ImportedSale_productId_idx" ON "ImportedSale" ("productId");
