import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DATABASE_URL = "file:./test.db";

// Bring the test database up to date with prisma/migrations before any test
// runs. Resolves relative sqlite paths against the project root (cwd), the
// same way src/db.ts and prisma.config.ts do.
export default function setup(): void {
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cliEntry = path.join(projectDir, "node_modules", "prisma", "build", "index.js");
  execFileSync(process.execPath, [cliEntry, "migrate", "deploy"], {
    cwd: projectDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
