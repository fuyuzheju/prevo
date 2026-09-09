-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CycleState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "productType" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "inventory" INTEGER NOT NULL,
    "soldTransit" INTEGER NOT NULL,
    "boughtTransit" INTEGER NOT NULL,
    "sent" INTEGER NOT NULL,
    "received" INTEGER NOT NULL,
    "sale" INTEGER NOT NULL,
    "purchase" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CycleState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScopeRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "productType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScopeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "CycleState_userId_productType_idx" ON "CycleState"("userId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "CycleState_userId_productType_cycle_key" ON "CycleState"("userId", "productType", "cycle");

-- CreateIndex
CREATE INDEX "ScopeRecord_userId_productType_idx" ON "ScopeRecord"("userId", "productType");
