import assert from "node:assert/strict";
import { test } from "node:test";
import type { CategoryTemplate } from "./catalog.ts";
import { pickDaily, PROMPTS_PER_DAY, utcDateKey } from "./puzzle.ts";

function category(key: string, entityType: string): CategoryTemplate {
  return { key, entityType, prompt: `Name ${key}`, answerIds: [], priorShares: {}, skewed: true, skewRatio: 2, bonusAnswerIds: [] };
}

const pool = [
  ...Array.from({ length: 9 }, (_, i) => category(`character|${i}`, "character")),
  category("weapon|sword", "weapon"),
];

test("the date key is the UTC calendar day", () => {
  assert.equal(utcDateKey(new Date("2026-10-27T23:59:59Z")), "2026-10-27");
  assert.equal(utcDateKey(new Date("2026-10-28T00:00:01Z")), "2026-10-28");
});

test("a date picks the same seven prompts regardless of pool order", () => {
  const picks = pickDaily("2026-10-27", pool).map((c) => c.key);
  const reversed = pickDaily("2026-10-27", [...pool].reverse()).map((c) => c.key);
  assert.equal(picks.length, PROMPTS_PER_DAY);
  assert.deepEqual(picks, reversed);
  assert.equal(new Set(picks).size, PROMPTS_PER_DAY);
});

test("different dates draw different puzzles", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const orders = new Set(days.map((day) => pickDaily(day, pool).map((c) => c.key).join("|")));
  assert.ok(orders.size > 1);
});

test("seven prompts never share one entity type when the pool has more", () => {
  for (let day = 1; day <= 28; day++) {
    const picks = pickDaily(`2026-02-${String(day).padStart(2, "0")}`, pool);
    assert.ok(new Set(picks.map((c) => c.entityType)).size > 1, `all one type on day ${day}`);
  }
});

test("a pool smaller than a day's puzzle throws", () => {
  assert.throws(() => pickDaily("2026-10-27", pool.slice(0, PROMPTS_PER_DAY - 1)), /needs at least/);
});
