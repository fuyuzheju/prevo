import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Runs before every test file's imports. Tests import src/ modules directly
// rather than src/index.ts, so nothing else loads .env for them; doing it here
// keeps test configuration aligned with how the server actually runs (notably
// PREDICTOR_PYTHON for the Python predictor). Absent .env is fine — dotenv
// no-ops and the defaults apply.
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

// Point the db singleton at the test database before src/db.ts is first
// imported. This must win over anything in .env.
process.env.DATABASE_URL = "file:./test.db";
