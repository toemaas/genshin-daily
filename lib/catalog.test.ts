import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aliasVariants,
  characterSurveyWeight,
  entityMatches,
  type CatalogEntity,
  FOUR_STAR_OWNERSHIP_SCALE,
  gearPriorWeight,
  multiplyWeights,
  NAME_LENGTH_BONUS,
  normalizeAlias,
  OWNERSHIP_SAMPLE,
  POLL_EMPHASIS,
  POLL_VOTES,
  priorIsSkewed,
  sharesFromWeights,
  skewRatio,
  VERSION_TROUGH,
  versionCurve,
} from "./catalog.ts";

test("Hu Tao and Hutao normalize to the same alias", () => {
  assert.equal(normalizeAlias("Hu Tao"), "hutao");
  assert.equal(normalizeAlias("Hutao"), "hutao");
  assert.equal(normalizeAlias("hu-tao"), "hutao");
  assert.ok(aliasVariants("Hu Tao").includes("Hutao"));
});

test("shares follow salience and sum to 1", () => {
  const shares = sharesFromWeights({ niche: 1, common: 8, other: 1 });
  const sum = Object.values(shares).reduce((total, share) => total + share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(shares.common > shares.niche);
  assert.equal(shares.niche, shares.other);
  for (const share of Object.values(shares)) assert.ok(share > 0);
});

test("character weight emphasizes the poll and discounts 4-star ownership", () => {
  const votes = 73_954;
  const poll = votes * (OWNERSHIP_SAMPLE / POLL_VOTES) * POLL_EMPHASIS;
  const fiveStar = characterSurveyWeight(64_965, 5_172, votes, 5);
  assert.equal(fiveStar, 64_965 + 5_172 + poll);
  assert.ok(poll > 64_965 * 0.25);

  const fourStar = characterSurveyWeight(64_965, 5_172, votes, 4);
  assert.equal(fourStar, 64_965 * FOUR_STAR_OWNERSHIP_SCALE + 5_172 + poll);
  assert.ok(fourStar < fiveStar);
});

test("a popular 5-star outweighs a widely owned 4-star", () => {
  const arlecchino = characterSurveyWeight(46_650, 4_176, 48_892, 5);
  const chevreuse = characterSurveyWeight(84_546, 2_754, 1_866, 4);
  assert.ok(arlecchino > chevreuse);
});

test("a missing poll cell adds no fame", () => {
  assert.equal(characterSurveyWeight(80_004, 71_667, 0, 5), 80_004 + 71_667);
});

const gearSpan = { min: 1, max: 7.01 };

test("gear release weight is a U from launch to the current version", () => {
  const early = versionCurve("1.0", gearSpan);
  const middle = versionCurve("4.0", gearSpan);
  const current = versionCurve("7.1", gearSpan);
  assert.equal(early, 1);
  assert.equal(current, 1);
  assert.ok(Math.abs(middle - VERSION_TROUGH) < 0.01);
  assert.ok(early > middle && current > middle);
});

test("a shorter gear name adds only a small bonus", () => {
  const short = gearPriorWeight(5, "1.0", "Halberd", gearSpan);
  const long = gearPriorWeight(5, "1.0", "Nighttime Whispers in the Echoing Woods", gearSpan);
  assert.ok(short > long);
  assert.ok(short / long <= 1 + NAME_LENGTH_BONUS + 1e-9);

  const sameName = gearPriorWeight(5, "1.0", "Halberd", gearSpan) / gearPriorWeight(4, "1.0", "Halberd", gearSpan);
  assert.ok(sameName > short / long);
});

test("a category multiplier scales only the listed answer", () => {
  const weights = { "character:fischl": 10, "character:venti": 8, "character:mona": 4 };
  const scaled = multiplyWeights(weights, { "character:fischl": 3, "character:venti": 0.5 });
  assert.equal(scaled["character:fischl"], 30);
  assert.equal(scaled["character:venti"], 4);
  assert.equal(scaled["character:mona"], 4);
  assert.throws(() => multiplyWeights(weights, { "character:albedo": 2 }), /albedo/);
});

test("an extra region matches beside the catalog region", () => {
  const nefer: CatalogEntity = {
    id: "character:nefer",
    type: "character",
    name: "Nefer",
    stars: 5,
    element: "Dendro",
    region: "Nod-Krai",
    exceptions: { region: ["Sumeru"] },
  };
  assert.equal(entityMatches(nefer, { region: "Sumeru" }), true);
  assert.equal(entityMatches(nefer, { region: "Nod-Krai" }), true);
  assert.equal(entityMatches(nefer, { region: "Sumeru", element: "Dendro" }), true);
  assert.equal(entityMatches(nefer, { region: "Sumeru", element: "Pyro" }), false);
});

test("a flat prior is not skewed", () => {
  assert.equal(priorIsSkewed({ a: 2, b: 2, c: 2 }), false);
  assert.equal(priorIsSkewed({ a: 1, b: 4 }), true);
});

test("one standout answer does not make a flat list skewed", () => {
  const weights: Record<string, number> = { sucrose: 18.1, prune: 7.1 };
  for (const [i, weight] of [9.5, 9.5, 9.5, 9.4, 9.4, 9.2, 9.2, 9.1].entries()) weights[`flat${i}`] = weight;
  assert.equal(priorIsSkewed(weights), false);
});

test("spread across the whole list is skewed", () => {
  assert.equal(priorIsSkewed({ a: 8, b: 6, c: 4, d: 3, e: 2, f: 2, g: 1, h: 1 }), true);
  assert.equal(skewRatio({ a: 8, b: 6, c: 4, d: 3, e: 2, f: 2, g: 1, h: 1 }), 7);
});
