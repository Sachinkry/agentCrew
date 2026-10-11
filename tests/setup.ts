// Use in-memory SQLite for all tests
process.env["DATABASE_URL"] = ":memory:";
process.env["MOCK_LLM"] = "1";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createRequire } from "module";
import * as schema from "../src/core/schema.js";
import { setDb } from "../src/core/db.js";

// drizzle-kit's ESM build can't load under vitest; its CJS build can.
const { generateSQLiteDrizzleJson, generateSQLiteMigration } = createRequire(import.meta.url)("drizzle-kit/api");

// Build the tables from schema.ts itself, so the test DB can't drift from the real one.
const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = OFF"); // tests insert minimal rows without every parent
const statements = await generateSQLiteMigration(
  await generateSQLiteDrizzleJson({}),
  await generateSQLiteDrizzleJson(schema)
);
for (const stmt of statements) sqlite.exec(stmt);

setDb(drizzle(sqlite, { schema }), sqlite);
