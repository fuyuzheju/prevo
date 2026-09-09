import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

// DATABASE_URL is "file:./dev.db". Relative sqlite paths resolve against the
// project root (where prisma.config.ts lives), matching the CLI: the app and
// migrations must share one database file.
function resolveSqliteUrl(url: string): string {
  const match = /^file:(.+)$/.exec(url);
  if (!match) return url; // e.g. ":memory:" or a non-sqlite scheme
  const rest = match[1]!;
  if (path.isAbsolute(rest)) return rest;
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.resolve(projectDir, rest);
}

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: "file:" + resolveSqliteUrl(databaseUrl) });

export const db = new PrismaClient({ adapter });

export type DbClient = typeof db;
