import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blendShare,
  fillsRequiredPoints,
  pointsByAnswer,
  pointsForPercentile,
  PRIOR_FLOOR,
  scoreBasis,
  snapshotShares,
} from "./scoring.ts";

test("no recorded answers leaves the prior in place", () => {
  assert.equal(blendShare(0, 0.29, 0), 0.29);
});

test("counts that match the prior stay on the prior", () => {
  const share = blendShare(29, 0.29, 100);
  assert.ok(Math.abs(share - 0.29) < 1e-12);
});

test("a herd cannot push an obvious answer below half its prior", () => {
  const share = blendShare(0, 0.29, 10_000);
  assert.equal(share, 0.29 * PRIOR_FLOOR);
});

test("a sleeper the prior underweighted can rise", () => {
  const lifted = blendShare(40, 0.02, 80);
  assert.ok(lifted > 0.02);
  assert.ok(lifted > 0.02 * PRIOR_FLOOR);
});

test("points drop as the answer becomes more expected", () => {
  assert.equal(pointsForPercentile(0), 10);
  assert.equal(pointsForPercentile(0.1), 30);
  assert.equal(pointsForPercentile(0.45), 60);
  assert.equal(pointsForPercentile(0.8), 85);
  assert.equal(pointsForPercentile(1), 85);
});

/** n answers with strictly falling shares, a0 most expected. */
function descending(n: number): Record<string, number> {
  const shares: Record<string, number> = {};
  for (let i = 0; i < n; i++) shares[`a${i}`] = (n - i) / 1000;
  return shares;
}

test("every category size fills 10 through 85", () => {
  for (let n = 8; n <= 120; n++) {
    assert.ok(fillsRequiredPoints(pointsByAnswer(descending(n))), `${n} answers`);
  }
});

test("30 and 60 hold the most answers", () => {
  for (let n = 8; n <= 120; n++) {
    const tally = { 10: 0, 30: 0, 60: 0, 85: 0, 100: 0 };
    for (const points of Object.values(pointsByAnswer(descending(n)))) tally[points]++;
    const middle = Math.min(tally[30], tally[60]);
    assert.ok(middle > tally[10] && middle > tally[85], `${n} answers: ${JSON.stringify(tally)}`);
    assert.equal(tally[100], 0, `${n} answers ranked an answer at 100`);
  }
});

test("points follow rank, not raw share", () => {
  assert.deepEqual(Object.values(pointsByAnswer(descending(8))), [10, 30, 30, 30, 60, 60, 60, 85]);
});

test("a bonus answer scores 100 and leaves the ranking", () => {
  const shares = descending(9);
  const points = pointsByAnswer(shares, ["a8"]);
  assert.equal(points.a8, 100);
  assert.deepEqual(pointsByAnswer(shares, ["a8"]), { ...pointsByAnswer(descending(8)), a8: 100 });
  assert.ok(fillsRequiredPoints(points));
});

test("a bonus answer must belong to the category", () => {
  assert.throws(() => pointsByAnswer(descending(8), ["nobody"]), /not in this category/);
});

test("tied shares get the same points", () => {
  const shares = { a: 0.3, b: 0.2, c: 0.2, d: 0.1, e: 0.08, f: 0.06, g: 0.04, h: 0.02 };
  const points = pointsByAnswer(shares);
  assert.equal(points.b, points.c);
  assert.ok(fillsRequiredPoints(points));
});

test("ties that swallow a tier fall back to ranking share levels", () => {
  const shares: Record<string, number> = { top: 0.4, mid: 0.2, low: 0.1 };
  for (let i = 0; i < 9; i++) shares[`tail${i}`] = 0.03;
  const points = pointsByAnswer(shares);
  assert.ok(fillsRequiredPoints(points));
  assert.deepEqual([points.top, points.mid, points.low, points.tail0], [10, 30, 60, 85]);
});

test("the same snapshot always gives the same points", () => {
  const shares = snapshotShares({ kaeya: 0.4, aloy: 0.1, qiqi: 0.5 }, { aloy: 3 });
  assert.deepEqual(pointsByAnswer(shares), pointsByAnswer({ ...shares }));
});

test("the result label switches once 80 answers exist", () => {
  assert.equal(scoreBasis(0), "Estimated from popularity");
  assert.equal(scoreBasis(79), "Estimated from popularity");
  assert.equal(scoreBasis(80), "Based on 80 answers");
});

test("a snapshot stays fixed until new counts are passed in", () => {
  const prior = { kaeya: 0.4, aloy: 0.1, qiqi: 0.5 };
  const published = snapshotShares(prior, { kaeya: 2, qiqi: 2 });
  assert.deepEqual(published, snapshotShares(prior, { kaeya: 2, qiqi: 2 }));

  const nextPuzzle = snapshotShares(prior, { kaeya: 2, qiqi: 2, aloy: 30 });
  assert.ok(nextPuzzle.aloy > published.aloy);
  assert.ok(nextPuzzle.kaeya >= prior.kaeya * PRIOR_FLOOR);
});
