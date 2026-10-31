/** Shared catalog shapes and the day-zero prior math. */

export const MIN_CATEGORY_SIZE = 8;

/**
 * A prior counts as skewed when its most salient quarter outweighs its least salient quarter by this much.
 * Gear lists sit at 1.70 and up. 4-star character lists with one standout answer sit at 1.60 and below.
 */
export const SKEW_RATIO = 1.65;

/** Players in the ownership and usage survey. Version 7.0 Phase II*/
export const OWNERSHIP_SAMPLE = 89211;

/** Ballots in the 2025 HoYoLab character poll. */
export const POLL_VOTES = 1_243_707;

/**
 * 4-stars are much easier to obtain than 5-stars, so a high owned count is mostly
 * availability. Ownership of a 4-star counts half. Usage is left alone: it already
 * measures who people play.
 */
export const FOUR_STAR_OWNERSHIP_SCALE = 0.5;

/**
 * Sample-scaled poll votes are multiplied by this.
 * 1 was the old "small bump." 4 makes fame a real part of the weight.
 */
export const POLL_EMPHASIS = 4;

/**
 * Day-zero weight for a character.
 * Ownership and usage are counts out of OWNERSHIP_SAMPLE.
 * Poll votes are scaled into that sample, then multiplied by POLL_EMPHASIS.
 * A blank poll cell passes votes as 0. Stars below 5 use FOUR_STAR_OWNERSHIP_SCALE.
 */
export function characterSurveyWeight(owned: number, usage: number, votes = 0, stars = 5): number {
  if (![owned, usage, votes, stars].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("owned, usage, votes, and stars must be non-negative numbers");
  }
  if (!(stars >= 1)) throw new Error("stars must be at least 1");
  const ownershipScale = stars >= 5 ? 1 : FOUR_STAR_OWNERSHIP_SCALE;
  return ownershipScale * owned + usage + votes * (OWNERSHIP_SAMPLE / POLL_VOTES) * POLL_EMPHASIS;
}

/** 4-star and 5-star gear should be guessed before 1-star starters. */
export const GEAR_STAR_WEIGHT: Record<number, number> = { 1: 1, 2: 1.5, 3: 2.2, 4: 3.6, 5: 5.5 };

/**
 * Middle of the release span, relative to the two ends (which are 1).
 * Launch gear and current gear are remembered; the middle of the timeline is the trough.
 */
export const VERSION_TROUGH = 0.55;

/** Shortest names get this much extra. Long names get none. This stays a small slice of the weight. */
export const NAME_LENGTH_BONUS = 0.12;
const SHORT_NAME_LENGTH = 8;
const LONG_NAME_LENGTH = 32;

export interface VersionSpan {
  /** Earliest and latest gear release, as versionNumber values. */
  min: number;
  max: number;
}

/** "2.8" -> 2.08, so patch order stays correct when a minor reaches two digits. */
export function versionNumber(version?: string): number | undefined {
  if (!version) return undefined;
  const [majorText, minorText = "0"] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isFinite(major) || major < 1) return undefined;
  return major + (Number.isFinite(minor) ? minor : 0) / 100;
}

/**
 * U-shaped release weight on [span.min, span.max].
 * Both ends are 1. The midpoint is VERSION_TROUGH. A missing version sits in the trough.
 */
export function versionCurve(version: string | undefined, span: VersionSpan): number {
  const value = versionNumber(version);
  if (value === undefined || !(span.max > span.min)) return span.max > span.min ? VERSION_TROUGH : 1;
  const t = Math.min(1, Math.max(0, (value - span.min) / (span.max - span.min)));
  const rise = (2 * t - 1) ** 2;
  return VERSION_TROUGH + (1 - VERSION_TROUGH) * rise;
}

/** 1 for a long name, up to 1 + NAME_LENGTH_BONUS for a name of SHORT_NAME_LENGTH or less. */
export function nameLengthFactor(name: string): number {
  const length = name.trim().replace(/\s+/g, " ").length;
  const t = Math.min(1, Math.max(0, (length - SHORT_NAME_LENGTH) / (LONG_NAME_LENGTH - SHORT_NAME_LENGTH)));
  return 1 + NAME_LENGTH_BONUS * (1 - t);
}

/**
 * Day-zero weight for a weapon or artifact.
 * Star rating is the main term. Release version is a U across the gear timeline.
 * Name length can add at most NAME_LENGTH_BONUS.
 */
export function gearPriorWeight(
  stars: number,
  version: string | undefined,
  name: string,
  span: VersionSpan,
): number {
  const star = GEAR_STAR_WEIGHT[stars] ?? 1;
  return star * versionCurve(version, span) * nameLengthFactor(name);
}

/** Types the build imports from genshin-db. Answers defined in data/extra-categories.json can use any type. */
export type EntityType = "character" | "weapon" | "artifact";

/** Scalar facts a hand-written exception may add beside the catalog value. */
export const EXCEPTION_FIELDS = ["element", "weaponType", "region", "stars", "version"] as const;

export type ExceptionField = (typeof EXCEPTION_FIELDS)[number];

export interface CatalogEntity {
  id: string;
  /** An EntityType for genshin-db entities. The id prefix for answers defined in extra-categories.json. */
  type: string;
  name: string;
  /** Hand-ranked salience, only on answers defined in extra-categories.json. */
  weight?: number;
  stars?: number;
  element?: string;
  weaponType?: string;
  region?: string;
  version?: string;
  /** Extra field values from data/exceptions.json. The catalog value stays in place. */
  exceptions?: Partial<Record<ExceptionField, string[]>>;
}

/** Catalog value plus any hand-written extras for that field. */
export function fieldValues(entity: CatalogEntity, field: string): string[] {
  const raw = entity[field as keyof CatalogEntity];
  const primary = raw === undefined || raw === null || raw === "" || typeof raw === "object" ? undefined : String(raw);
  const extra = entity.exceptions?.[field as ExceptionField] ?? [];
  return [...new Set(primary ? [primary, ...extra] : [...extra])];
}

/** Every filter field must match the catalog value or one of its extras. */
export function entityMatches(entity: CatalogEntity, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([field, expected]) => fieldValues(entity, field).includes(expected));
}

export interface CategoryTemplate {
  key: string;
  /** The answers' shared entity type, or "mixed" when a hand-written category spans several. */
  entityType: string;
  prompt: string;
  answerIds: string[];
  /** Answer id to share. Shares are positive and sum to 1. */
  priorShares: Record<string, number>;
  skewed: boolean;
  /** Top-quarter mean weight over bottom-quarter mean weight. See skewRatio. */
  skewRatio: number;
  /** Hand-picked answers worth 100 points, from data/bonus-answers.json. They sit outside the ranking. */
  bonusAnswerIds: string[];
}

/**
 * Extra names that stay different after normalizeAlias.
 * Canonical names live on the entity. Spacing and punctuation variants are not stored.
 */
export type AliasIndex = Record<string, string[]>;

/** Fold case, spaces, and punctuation so "Hu Tao" and "Hutao" match. */
export function normalizeAlias(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Human-readable spellings derived from a name, including the spaceless form. */
export function aliasVariants(name: string): string[] {
  const forms = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed) forms.add(trimmed);
  };

  add(name);
  const deaccent = name.normalize("NFKD").replace(/\p{M}/gu, "");
  add(deaccent);
  const noApos = deaccent.replace(/['’]/g, "");
  add(noApos);
  const spaced = noApos
    .replace(/[-‐‑–—]/g, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  add(spaced);
  const collapsed = spaced.replace(/ /g, "");
  if (collapsed.length >= 3 && collapsed.toLowerCase() !== spaced.toLowerCase()) {
    add(collapsed);
    add(collapsed.charAt(0).toUpperCase() + collapsed.slice(1).toLowerCase());
  }
  return [...forms];
}

/**
 * Multiply listed answer weights. Unlisted answers keep their base weight.
 * Every multiplier must be a positive finite number, and every id must already be an answer.
 */
export function multiplyWeights(
  weights: Record<string, number>,
  multipliers: Record<string, number>,
): Record<string, number> {
  for (const [id, multiplier] of Object.entries(multipliers)) {
    if (!(id in weights)) throw new Error(`Weight multiplier for ${id} does not match an answer`);
    if (!(multiplier > 0) || !Number.isFinite(multiplier)) {
      throw new Error(`Weight multiplier for ${id} must be a positive finite number`);
    }
  }
  const scaled: Record<string, number> = {};
  for (const [id, weight] of Object.entries(weights)) {
    scaled[id] = weight * (multipliers[id] ?? 1);
  }
  return scaled;
}

/**
 * Largest-remainder shares at 1e-6 precision.
 * Every weight must be positive. The result sums to 1.
 */
export function sharesFromWeights(weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights).sort();
  if (ids.length === 0) throw new Error("Cannot build shares from an empty weight map");

  const rows = ids.map((id) => {
    const weight = weights[id];
    if (!(weight > 0) || !Number.isFinite(weight)) {
      throw new Error(`Weight for ${id} must be a positive finite number`);
    }
    return { id, weight };
  });

  const scale = 1_000_000;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const parts = rows.map((row) => {
    const exact = (row.weight / total) * scale;
    const base = Math.floor(exact);
    return { id: row.id, base, frac: exact - base };
  });

  let leftover = scale - parts.reduce((sum, part) => sum + part.base, 0);
  const byFraction = [...parts].sort(
    (a, b) => b.frac - a.frac || a.id.localeCompare(b.id),
  );
  for (let i = 0; i < leftover; i++) byFraction[i].base += 1;

  const zeros = parts.filter((part) => part.base < 1);
  const donors = [...parts].sort((a, b) => b.base - a.base || a.id.localeCompare(b.id));
  for (const zero of zeros) {
    const donor = donors.find((part) => part !== zero && part.base > 1);
    if (!donor) throw new Error("Not enough weight to give every answer a positive share");
    donor.base -= 1;
    zero.base += 1;
  }

  const shares: Record<string, number> = {};
  for (const part of parts) shares[part.id] = part.base / scale;
  return shares;
}

/**
 * Mean weight of the top quarter of answers over the mean of the bottom quarter.
 * A quarter is ceil(n / 4) answers, so one standout at either end cannot make a flat list look skewed.
 */
export function skewRatio(weights: Record<string, number>): number {
  const values = Object.values(weights).sort((a, b) => b - a);
  if (values.length === 0) throw new Error("Skew is undefined for an empty weight map");
  if (!(values[values.length - 1] > 0)) throw new Error("Skew is only defined for positive weights");

  const quarter = Math.ceil(values.length / 4);
  const mean = (part: number[]) => part.reduce((sum, value) => sum + value, 0) / part.length;
  return mean(values.slice(0, quarter)) / mean(values.slice(-quarter));
}

export function priorIsSkewed(weights: Record<string, number>): boolean {
  return skewRatio(weights) >= SKEW_RATIO;
}
