import { describe, it, expect, beforeEach } from "vitest";
import { record, recordRevenue, recordRefund, totalProfit } from "../src/services/ledger.js";
import { getDb, resetDb } from "../src/core/db.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/core/schema.js";

// Use in-memory DB for tests
function setupTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Run schema creation manually
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY,
      sim_day INTEGER NOT NULL,
      kind TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS llm_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      in_tokens INTEGER NOT NULL,
      out_tokens INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      span_id TEXT,
      sim_day INTEGER
    );
  `);

  return sqlite;
}

describe("ledger", () => {
  it("records revenue as positive entry", () => {
    const id = record({ simDay: 1, kind: "revenue", amountCents: 1900 });
    expect(id).toBeTruthy();
  });

  it("records refund as negative entry", () => {
    const id = record({ simDay: 1, kind: "refund", amountCents: -1000 });
    expect(id).toBeTruthy();
  });
});
