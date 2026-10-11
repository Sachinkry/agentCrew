// Use in-memory SQLite for all tests
process.env["DATABASE_URL"] = ":memory:";
process.env["MOCK_LLM"] = "1";

// Bootstrap schema for in-memory DB
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/core/schema.js";
import { resetDb } from "../src/core/db.js";

// Patch getDb to return an in-memory instance before any test runs
const sqlite = new Database(":memory:");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Create all tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, seed INTEGER NOT NULL, git_sha TEXT,
    entire_checkpoint TEXT, trace_root TEXT, config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL,
    cost_cents_est INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', artifact_path TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, text TEXT NOT NULL,
    verified INTEGER, note TEXT
  );
  CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, product_id TEXT,
    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    utm TEXT, sim_day INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS traffic (
    id TEXT PRIMARY KEY, sim_day INTEGER NOT NULL, channel_id TEXT NOT NULL,
    product_id TEXT, utm TEXT, sessions INTEGER NOT NULL DEFAULT 0,
    add_to_cart INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    price_paid_cents INTEGER NOT NULL, discount_pct REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'paid', dodo_ref TEXT, sim_day INTEGER NOT NULL,
    download_token TEXT, token_expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY, order_id TEXT, kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', sim_day INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, role TEXT NOT NULL,
    body TEXT NOT NULL, span_id TEXT
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, from_agent TEXT NOT NULL, to_agent TEXT NOT NULL,
    brief TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    result_json TEXT, sim_day INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY, hypothesis TEXT NOT NULL, lever TEXT NOT NULL,
    target_id TEXT, params_json TEXT NOT NULL, start_day INTEGER NOT NULL,
    end_day INTEGER, result_json TEXT,
    decision TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS market_signals (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, category TEXT NOT NULL,
    keyword TEXT NOT NULL, score REAL NOT NULL, observed_day INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY, sim_day INTEGER NOT NULL, kind TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, ref_type TEXT, ref_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY, run_id TEXT, agent TEXT NOT NULL, model TEXT NOT NULL,
    in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, cost_cents INTEGER NOT NULL,
    span_id TEXT, sim_day INTEGER
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, run_id TEXT, sim_day INTEGER NOT NULL,
    agent TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL,
    ts INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS run_metrics (
    run_id TEXT NOT NULL, sim_day INTEGER NOT NULL, revenue INTEGER NOT NULL DEFAULT 0,
    profit INTEGER NOT NULL DEFAULT 0, inference_cost INTEGER NOT NULL DEFAULT 0,
    conversion_by_channel_json TEXT, claim_verified_rate REAL,
    policy_blocks INTEGER NOT NULL DEFAULT 0, cost_per_order REAL
  );
`);

// Override the module-level db singleton
import { setDb } from "../src/core/db.js";
setDb(drizzle(sqlite, { schema }));
