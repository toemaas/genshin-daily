/**
 * Picks the day's 7 prompts from the eligible categories, seeded by the UTC date,
 * so every server draws the same puzzle without storing a schedule.
 */
import type { CategoryTemplate } from "./catalog.ts";

export const PROMPTS_PER_DAY = 7;
export const PROMPT_SECONDS = 25;

export function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** FNV-1a over the date string. */
export function dateSeed(date: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Date-seeded shuffle of the pool, first 7. The result does not depend on the
 * pool's order, and the day never uses one entity type for all seven prompts
 * when the pool has more than one.
 */
export function pickDaily(date: string, pool: readonly CategoryTemplate[]): CategoryTemplate[] {
  if (pool.length < PROMPTS_PER_DAY) {
    throw new Error(`The daily puzzle needs at least ${PROMPTS_PER_DAY} eligible categories, got ${pool.length}`);
  }
  const random = mulberry32(dateSeed(date));
  const shuffled = [...pool].sort((a, b) => a.key.localeCompare(b.key));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picks = shuffled.slice(0, PROMPTS_PER_DAY);
  const firstType = picks[0].entityType;
  if (picks.every((pick) => pick.entityType === firstType)) {
    const other = shuffled.slice(PROMPTS_PER_DAY).find((category) => category.entityType !== firstType);
    if (other) picks[PROMPTS_PER_DAY - 1] = other;
  }
  return picks;
}
