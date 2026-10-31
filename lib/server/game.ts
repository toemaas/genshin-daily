/**
 * Server-side game state: the frozen daily puzzle, per-player progress, and the
 * answer flow. One Node process over one SQLite file; the route handlers only
 * parse the request and hand the cookie and text to the functions here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { categoryCounts, dailySnapshots, promptServes, submissions } from "../../db/schema.ts";
import type { AnswerApiResponse, CurrentPromptView, GameStateView, ResultView } from "../api-types.ts";
import type { AliasIndex, CatalogEntity, CategoryTemplate } from "../catalog.ts";
import { attemptFeedback, buildNameIndex, matchAnswer, type NameIndex } from "../matcher.ts";
import { pointsByAnswer, PRIOR_SAMPLE_SIZE, snapshotShares } from "../scoring.ts";
import { pickDaily, PROMPT_SECONDS, PROMPTS_PER_DAY, utcDateKey } from "../puzzle.ts";

export const PLAYER_COOKIE = "player";
/** Network slack past the visible deadline before a typed answer counts as late. */
export const GRACE_MS = 2_000;

export function validPlayerId(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) ? value : null;
}

interface Catalog {
  categories: CategoryTemplate[];
  categoriesByKey: Map<string, CategoryTemplate>;
  entitiesById: Map<string, CatalogEntity>;
  nameIndex: NameIndex;
}

function loadCatalog(): Catalog {
  const dir = path.join(process.cwd(), "data");
  const read = (name: string) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  const { entities } = read("catalog.json") as { entities: CatalogEntity[] };
  const aliases = read("aliases.json") as AliasIndex;
  const { categories } = read("categories.json") as { categories: CategoryTemplate[] };
  return {
    categories,
    categoriesByKey: new Map(categories.map((category) => [category.key, category])),
    entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
    nameIndex: buildNameIndex(entities, aliases),
  };
}

const globals = globalThis as typeof globalThis & { __catalog?: Catalog };
function catalog(): Catalog {
  return (globals.__catalog ??= loadCatalog());
}

function countsFor(categoryKey: string): Record<string, number> {
  const rows = db.select().from(categoryCounts).where(eq(categoryCounts.categoryKey, categoryKey)).all();
  return Object.fromEntries(rows.map((row) => [row.answerId, row.count]));
}

/** A category is playable with a skewed prior, or once 80 real answers back a flat one. */
function eligiblePool(categories: CategoryTemplate[]): CategoryTemplate[] {
  const totals = new Map(
    db
      .select({ key: categoryCounts.categoryKey, total: sql<number>`sum(${categoryCounts.count})` })
      .from(categoryCounts)
      .groupBy(categoryCounts.categoryKey)
      .all()
      .map((row) => [row.key, row.total]),
  );
  return categories.filter((category) => category.skewed || (totals.get(category.key) ?? 0) >= PRIOR_SAMPLE_SIZE);
}

interface DayPrompt {
  index: number;
  category: CategoryTemplate;
  /** Frozen when the day first loads. Today's answers never move today's points. */
  shares: Record<string, number>;
}

function dailyPrompts(date: string): DayPrompt[] {
  const { categories, categoriesByKey } = catalog();
  const select = () =>
    db.select().from(dailySnapshots).where(eq(dailySnapshots.date, date)).orderBy(asc(dailySnapshots.promptIndex)).all();
  let rows = select();
  if (rows.length < PROMPTS_PER_DAY) {
    const picks = pickDaily(date, eligiblePool(categories));
    db.insert(dailySnapshots)
      .values(
        picks.map((category, index) => ({
          date,
          promptIndex: index,
          categoryKey: category.key,
          shares: snapshotShares(category.priorShares, countsFor(category.key)),
        })),
      )
      .onConflictDoNothing()
      .run();
    rows = select();
  }
  return rows.map((row) => {
    const category = categoriesByKey.get(row.categoryKey);
    if (!category) throw new Error(`Snapshot for ${date} names ${row.categoryKey}, which is not in categories.json`);
    return { index: row.promptIndex, category, shares: row.shares };
  });
}

function playerSubmissions(playerId: string, date: string) {
  return db
    .select()
    .from(submissions)
    .where(sql`${submissions.playerId} = ${playerId} and ${submissions.date} = ${date}`)
    .orderBy(asc(submissions.promptIndex))
    .all();
}

/** Records when the prompt was first shown; later calls return that first time. */
function ensureServe(playerId: string, date: string, promptIndex: number, now: number): number {
  db.insert(promptServes).values({ playerId, date, promptIndex, servedAt: now }).onConflictDoNothing().run();
  const row = db
    .select()
    .from(promptServes)
    .where(sql`${promptServes.playerId} = ${playerId} and ${promptServes.date} = ${date} and ${promptServes.promptIndex} = ${promptIndex}`)
    .get();
  return row?.servedAt ?? now;
}

export function gameStateFor(playerId: string, now = Date.now()): GameStateView {
  const date = utcDateKey(new Date(now));
  const prompts = dailyPrompts(date);
  const { entitiesById } = catalog();
  const subs = playerSubmissions(playerId, date);
  const results: ResultView[] = subs.map((row) => ({
    index: row.promptIndex,
    prompt: prompts[row.promptIndex].category.prompt,
    answer: row.answerId ? (entitiesById.get(row.answerId)?.name ?? row.answerId) : null,
    points: row.points,
  }));
  let current: CurrentPromptView | null = null;
  if (subs.length < prompts.length) {
    const index = subs.length;
    const servedAt = ensureServe(playerId, date, index, now);
    const msLeft = Math.max(0, servedAt + PROMPT_SECONDS * 1000 - now);
    current = { index, prompt: prompts[index].category.prompt, msLeft };
  }
  return {
    date,
    promptCount: prompts.length,
    promptSeconds: PROMPT_SECONDS,
    total: results.reduce((sum, result) => sum + result.points, 0),
    results,
    current,
  };
}

/**
 * One attempt. A rejection changes nothing and keeps the player on the prompt.
 * An accepted answer records the submission and counts toward future rarity.
 * An attempt past the deadline records a 0-point timeout and moves on. Typed
 * text gets GRACE_MS of network slack. Empty text is the client reporting that
 * its own countdown ran out, so it gets none.
 */
export function submitAnswer(playerId: string, text: string, now = Date.now()): AnswerApiResponse {
  const date = utcDateKey(new Date(now));
  const prompts = dailyPrompts(date);
  const index = playerSubmissions(playerId, date).length;
  if (index >= prompts.length) {
    return { accepted: false, reason: "done", message: "Today's puzzle is finished", state: gameStateFor(playerId, now) };
  }
  const { category, shares } = prompts[index];
  const servedAt = ensureServe(playerId, date, index, now);
  const grace = text.trim() ? GRACE_MS : 0;

  if (now > servedAt + PROMPT_SECONDS * 1000 + grace) {
    record(playerId, date, index, null, 0, null, now);
    return { accepted: false, reason: "timeout", message: "Time's up", state: gameStateFor(playerId, now) };
  }

  const feedback = attemptFeedback(matchAnswer(text, category.answerIds, catalog().nameIndex));
  if (!feedback.accepted) {
    return { accepted: false, reason: feedback.reason, message: feedback.message, state: gameStateFor(playerId, now) };
  }

  const points = pointsByAnswer(shares, category.bonusAnswerIds)[feedback.answerId];
  const recorded = record(playerId, date, index, feedback.answerId, points, text, now);
  if (recorded) {
    db.insert(categoryCounts)
      .values({ categoryKey: category.key, answerId: feedback.answerId, count: 1 })
      .onConflictDoUpdate({
        target: [categoryCounts.categoryKey, categoryCounts.answerId],
        set: { count: sql`${categoryCounts.count} + 1` },
      })
      .run();
  }
  const answer = catalog().entitiesById.get(feedback.answerId)?.name ?? feedback.answerId;
  return { accepted: true, answer, typo: feedback.typo, points, state: gameStateFor(playerId, now) };
}

/** False when this prompt already has a submission (a double POST); nothing is overwritten. */
function record(
  playerId: string,
  date: string,
  promptIndex: number,
  answerId: string | null,
  points: number,
  typed: string | null,
  now: number,
): boolean {
  const inserted = db
    .insert(submissions)
    .values({ playerId, date, promptIndex, answerId, points, typed, createdAt: now })
    .onConflictDoNothing()
    .run();
  return inserted.changes > 0;
}
