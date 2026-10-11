import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import fs from "fs";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb(dbPath?: string) {
  if (_db) return _db;

  const resolved =
    dbPath ?? process.env["DATABASE_URL"] ?? "./runs/autoshelf.sqlite";
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });
  return _db;
}

export function resetDb() {
  _db = null;
}

export function setDb(db: ReturnType<typeof drizzle>) {
  _db = db;
}

export type Db = ReturnType<typeof getDb>;
