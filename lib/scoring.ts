/**
 * Turns a day-zero prior and stored answer counts into the share used for points.
 * The share for a published puzzle is snapshotted. Later answers do not move it.
 */

/** Virtual answers the prior is worth in the blend. */
export const PRIOR_SAMPLE_SIZE = 80;

/**
 * Lowest share an answer keeps, as a fraction of its prior.
 * Players can lift a sleeper the prior missed. They cannot demote an obvious name in one herd.
 */
export const PRIOR_FLOOR = 0.5;

export function blendShare(
  count: number,
  priorShare: number,
  total: number,
  priorSampleSize = PRIOR_SAMPLE_SIZE,
): number {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  if (!Number.isInteger(total) || total < 0) throw new Error("total must be a non-negative integer");
  if (count > total) throw new Error("count cannot exceed total");
  if (!(priorShare > 0) || priorShare > 1) throw new Error("priorShare must be in (0, 1]");
  if (!(priorSampleSize > 0)) throw new Error("prior sample size must be positive");

  const smoothed = (count + priorSampleSize * priorShare) / (total + priorSampleSize);
  return Math.max(smoothed, priorShare * PRIOR_FLOOR);
}

export type RankedPoints = 10 | 30 | 60 | 85;
export type Points = RankedPoints | typeof BONUS_POINTS;

/** Points for a hand-picked answer in data/bonus-answers.json. Ranking never awards this. */
export const BONUS_POINTS = 100;

/**
 * Percentile bands within one category, most expected first.
 * Percentile is the fraction of the category's ranked answers above this one.
 * 30 and 60 are the widest bands, so most answers land in the middle.
 * Each band past the first is at least 1/MIN_CATEGORY_SIZE wide, so an 8-answer category fills all four.
 */
export const POINT_BANDS: ReadonlyArray<{ below: number; points: RankedPoints }> = [
  { below: 0.1, points: 10 },
  { below: 0.45, points: 30 },
  { below: 0.8, points: 60 },
];

/** The rest of the ranking, from the last band's cutoff through 1. */
const TAIL_POINTS: RankedPoints = 85;

/** Tiers every category must use. */
export const REQUIRED_POINTS: readonly RankedPoints[] = [10, 30, 60, 85];

export function pointsForPercentile(percentile: number): RankedPoints {
  if (!(percentile >= 0) || percentile > 1) throw new Error("percentile must be in [0, 1]");
  for (const band of POINT_BANDS) {
    if (percentile < band.below) return band.points;
  }
  return TAIL_POINTS;
}

/**
 * Points for every answer in one category, from its snapshot shares.
 * Bonus answers get BONUS_POINTS and sit outside the ranking. The rest are ranked by share.
 * Higher points mean the answer was less expected in this category.
 * Answers with equal shares always get equal points.
 * Ranks answers first. If ties leave one of REQUIRED_POINTS empty, ranks distinct share levels instead,
 * which fills every required tier whenever the ranked answers have at least 4 distinct shares.
 */
export function pointsByAnswer(
  shares: Record<string, number>,
  bonusIds: readonly string[] = [],
): Record<string, Points> {
  for (const id of Object.keys(shares)) {
    if (!(shares[id] > 0) || shares[id] > 1) throw new Error(`share for ${id} must be in (0, 1]`);
  }
  for (const id of bonusIds) {
    if (!(id in shares)) throw new Error(`Bonus answer ${id} is not in this category`);
  }
  const bonus = new Set(bonusIds);
  const ids = Object.keys(shares).filter((id) => !bonus.has(id));
  if (ids.length === 0) throw new Error("Cannot score a category with no ranked answers");

  const levels = [...new Set(ids.map((id) => shares[id]))].sort((a, b) => b - a);
  const above = new Map<number, number>();
  let ranked = 0;
  for (const level of levels) {
    above.set(level, ranked);
    ranked += ids.filter((id) => shares[id] === level).length;
  }

  let points: Record<string, Points> = assign(ids, (id) => above.get(shares[id])! / ids.length);
  if (!fillsRequiredPoints(points)) {
    const lastLevel = Math.max(levels.length - 1, 1);
    points = assign(ids, (id) => levels.indexOf(shares[id]) / lastLevel);
  }
  for (const id of bonus) points[id] = BONUS_POINTS;
  return points;
}

export function fillsRequiredPoints(points: Record<string, Points>): boolean {
  const used = new Set(Object.values(points));
  return REQUIRED_POINTS.every((tier) => used.has(tier));
}

function assign(ids: string[], percentileOf: (id: string) => number): Record<string, RankedPoints> {
  const points: Record<string, RankedPoints> = {};
  for (const id of ids) points[id] = pointsForPercentile(percentileOf(id));
  return points;
}

/** Result-card wording. The prior still leads until PRIOR_SAMPLE_SIZE real answers exist. */
export function scoreBasis(totalAnswers: number): string {
  if (!Number.isInteger(totalAnswers) || totalAnswers < 0) {
    throw new Error("totalAnswers must be a non-negative integer");
  }
  if (totalAnswers < PRIOR_SAMPLE_SIZE) return "Estimated from popularity";
  return `Based on ${totalAnswers} answers`;
}

/**
 * Shares to freeze when a puzzle is published.
 * Pass the counts from before this puzzle. Answers submitted today belong in the next snapshot.
 * Floored shares can sum to more than 1. Points come from pointsByAnswer, which only uses their order.
 */
export function snapshotShares(
  priorShares: Record<string, number>,
  counts: Record<string, number> = {},
): Record<string, number> {
  const ids = Object.keys(priorShares);
  if (ids.length === 0) throw new Error("Cannot snapshot an empty category");

  let total = 0;
  for (const id of ids) {
    const count = counts[id] ?? 0;
    if (!Number.isInteger(count) || count < 0) throw new Error(`count for ${id} must be a non-negative integer`);
    total += count;
  }

  const shares: Record<string, number> = {};
  for (const id of ids) shares[id] = blendShare(counts[id] ?? 0, priorShares[id], total);
  return shares;
}
