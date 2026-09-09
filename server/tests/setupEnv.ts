// Runs before every test file's imports: point the db singleton at the test
// database before src/db.ts is first imported.
process.env.DATABASE_URL = "file:./test.db";
