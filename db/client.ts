import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

/** Mirrors db/schema.ts so a fresh checkout runs without a migration step. */
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS category_counts (
  category_key TEXT NOT NULL,
  answer_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_key, answer_id)
);
CREATE TABLE IF NOT EXISTS daily_snapshots (
  date TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  category_key TEXT NOT NULL,
  shares TEXT NOT NULL,
  PRIMARY KEY (date, prompt_index)
);
CREATE TABLE IF NOT EXISTS submissions (
  player_id TEXT NOT NULL,
  date TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  answer_id TEXT,
  points INTEGER NOT NULL,
  typed TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date, prompt_index)
);
CREATE TABLE IF NOT EXISTS prompt_serves (
  player_id TEXT NOT NULL,
  date TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  served_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, date, prompt_index)
);
`;

function open() {
  const sqlite = new Database(process.env.DATABASE_FILE ?? "game.db");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(BOOTSTRAP);
  return drizzle(sqlite, { schema });
}

// One connection per process, kept across dev-server reloads.
const globals = globalThis as typeof globalThis & { __gameDb?: ReturnType<typeof open> };
export const db = (globals.__gameDb ??= open());
