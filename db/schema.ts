/**
 * The three kinds of rows that must survive a restart: running answer counts,
 * the frozen daily snapshots, and what each player submitted. prompt_serves
 * exists so the 25-second deadline is the server's clock, not the browser's.
 */
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Accepted answers per category, across all days. Feeds the next snapshot, never today's. */
export const categoryCounts = sqliteTable(
  "category_counts",
  {
    categoryKey: text("category_key").notNull(),
    answerId: text("answer_id").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.categoryKey, table.answerId] })],
);

/** One row per prompt per UTC date: the category and its shares, frozen when the day first loads. */
export const dailySnapshots = sqliteTable(
  "daily_snapshots",
  {
    date: text("date").notNull(),
    promptIndex: integer("prompt_index").notNull(),
    categoryKey: text("category_key").notNull(),
    shares: text("shares", { mode: "json" }).$type<Record<string, number>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.date, table.promptIndex] })],
);

/** One accepted answer or timeout per player per prompt. answerId is null on a timeout. */
export const submissions = sqliteTable(
  "submissions",
  {
    playerId: text("player_id").notNull(),
    date: text("date").notNull(),
    promptIndex: integer("prompt_index").notNull(),
    answerId: text("answer_id"),
    points: integer("points").notNull(),
    /** What the player typed, kept to mine future aliases. Null on a timeout. */
    typed: text("typed"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.date, table.promptIndex] })],
);

/** When each prompt was first shown to a player. Attempts after servedAt + 25s are timeouts. */
export const promptServes = sqliteTable(
  "prompt_serves",
  {
    playerId: text("player_id").notNull(),
    date: text("date").notNull(),
    promptIndex: integer("prompt_index").notNull(),
    servedAt: integer("served_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.date, table.promptIndex] })],
);
