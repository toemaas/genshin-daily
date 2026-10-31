/**
 * Builds a local example catalog from genshin-db.
 * Scope: characters, weapons, and artifacts. No images, voice lines, or music.
 *
 * Writes:
 *   data/catalog.json           entities and mechanical facts
 *   data/extra-aliases.json     hand-written aliases; this build reads the file and does not rewrite it
 *   data/exceptions.json        extra field values; this build reads the file and does not rewrite it
 *   data/weights.json           per-category weight multipliers; this build reads the file and does not rewrite it
 *   data/extra-categories.json  hand-written prompts and any answers genshin-db lacks; this build reads the file and does not rewrite it
 *   data/bonus-answers.json     per-category answers worth 100 points; this build reads the file and does not rewrite it
 *   data/aliases.json           generated aliases plus the hand-written ones
 *   data/categories.json        reusable prompts with day-zero prior shares
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import genshin from "genshin-db";
import {
  characterSurveyWeight,
  entityMatches,
  EXCEPTION_FIELDS,
  fieldValues,
  gearPriorWeight,
  multiplyWeights,
  normalizeAlias,
  priorIsSkewed,
  sharesFromWeights,
  skewRatio,
  versionNumber,
  type AliasIndex,
  type CatalogEntity,
  type CategoryTemplate,
  type EntityType,
  type ExceptionField,
  type VersionSpan,
  MIN_CATEGORY_SIZE,
} from "../lib/catalog.ts";
import { fillsRequiredPoints, pointsByAnswer } from "../lib/scoring.ts";

const require = createRequire(import.meta.url);
const altnames = require("genshin-db/src/altnames.js") as {
  getAltNamesList(language: string, folder: string): string[];
  getFilename(language: string, folder: string, altname: string): string | undefined;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

const ASSOCIATION_REGION: Record<string, string> = {
  ASSOC_MONDSTADT: "Mondstadt",
  ASSOC_LIYUE: "Liyue",
  ASSOC_INAZUMA: "Inazuma",
  ASSOC_SUMERU: "Sumeru",
  ASSOC_FONTAINE: "Fontaine",
  ASSOC_NATLAN: "Natlan",
  ASSOC_NODKRAI: "Nod-Krai",
  ASSOC_NODKRAI_ZIBAI: "Nod-Krai",
  ASSOC_SNEZHNAYA: "Snezhnaya",
  ASSOC_SNEZHNAYA_STAR: "Snezhnaya",
  ASSOC_FATUI: "Snezhnaya",
};

const TOKEN_STOP = new Set(["the", "and", "from", "with", "into"]);

interface SurveyRow {
  usage: number;
  owned: number;
  votes: number;
}

interface DumpList<T> {
  filename: string[];
  result: T[];
}

interface RawCharacter {
  name: string;
  rarity: number;
  elementText?: string;
  weaponText?: string;
  region?: string;
  associationType?: string;
  version?: string;
}

interface RawWeapon {
  id: number;
  name: string;
  rarity: number;
  weaponText?: string;
  version?: string;
}

interface RawArtifact {
  name: string;
  rarityList: number[];
  version?: string;
  flower?: { name?: string };
  plume?: { name?: string };
  sands?: { name?: string };
  goblet?: { name?: string };
  circlet?: { name?: string };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function loadSurvey(): Map<string, SurveyRow> {
  const lines = readFileSync(path.join(dataDir, "popularity.csv"), "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert(lines[0] === "name,usage,owned,votes", "popularity.csv header must be name,usage,owned,votes");

  const survey = new Map<string, SurveyRow>();
  for (const line of lines.slice(1)) {
    const [name, usage, owned, votes = ""] = line.split(",").map((cell) => cell.trim());
    assert(name, "popularity.csv has a blank name");
    assert(!survey.has(name), `popularity.csv lists ${name} twice`);
    survey.set(name, {
      usage: parseCount(name, "usage", usage),
      owned: parseCount(name, "owned", owned),
      votes: votes === "" ? 0 : parseCount(name, "votes", votes),
    });
  }
  return survey;
}

function parseCount(name: string, column: string, value: string): number {
  const count = Number(value);
  assert(Number.isFinite(count) && count >= 0, `${name} has an invalid ${column} value`);
  return count;
}

function blankToUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function loadFolder<T>(folder: "characters" | "weapons" | "artifacts"): Array<{ filename: string; row: T }> {
  const dumped = genshin[folder]("names", {
    matchCategories: true,
    verboseCategories: true,
    dumpResult: true,
  }) as unknown as DumpList<T>;
  assert(Array.isArray(dumped.filename) && Array.isArray(dumped.result), `genshin-db returned no ${folder} list`);
  assert(dumped.filename.length === dumped.result.length, `${folder} filenames and rows differ in length`);
  return dumped.filename.map((filename, index) => ({ filename, row: dumped.result[index] }));
}

function characterEntities(): CatalogEntity[] {
  const entities: CatalogEntity[] = [];
  for (const { filename, row } of loadFolder<RawCharacter>("characters")) {
    if (filename === "manekin" || filename === "manekina" || filename === "aether" || filename === "lumine") {
      continue;
    }
    const element = blankToUndefined(row.elementText);
    const region = blankToUndefined(row.region) ?? ASSOCIATION_REGION[row.associationType ?? ""];
    entities.push({
      id: `character:${filename}`,
      type: "character",
      name: row.name,
      stars: row.rarity,
      element: element === "None" ? undefined : element,
      weaponType: blankToUndefined(row.weaponText),
      region,
      version: blankToUndefined(row.version),
    });
  }

  entities.push({
    id: "character:traveler",
    type: "character",
    name: "Traveler",
    stars: 5,
    weaponType: "Sword",
    version: "1.0",
  });
  entities.sort((a, b) => a.id.localeCompare(b.id));
  return entities;
}

function weaponEntities(): CatalogEntity[] {
  const byName = new Map<string, CatalogEntity>();
  for (const { filename, row } of loadFolder<RawWeapon>("weapons")) {
    const nameKey = row.name.trim().toLowerCase();
    if (byName.has(nameKey)) continue;
    byName.set(nameKey, {
      id: `weapon:${filename}`,
      type: "weapon",
      name: row.name,
      stars: row.rarity,
      weaponType: blankToUndefined(row.weaponText),
      version: blankToUndefined(row.version),
    });
  }
  return [...byName.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function artifactEntities(): Array<{ entity: CatalogEntity; pieces: string[] }> {
  const rows = loadFolder<RawArtifact>("artifacts").map(({ filename, row }) => {
    const pieces = [row.flower?.name, row.plume?.name, row.sands?.name, row.goblet?.name, row.circlet?.name]
      .filter((name): name is string => Boolean(name));
    return {
      entity: {
        id: `artifact:${filename}`,
        type: "artifact" as const,
        name: row.name,
        stars: Math.max(...row.rarityList),
        version: blankToUndefined(row.version),
      },
      pieces,
    };
  });
  rows.sort((a, b) => a.entity.id.localeCompare(b.entity.id));
  return rows;
}

function characterWeight(entity: CatalogEntity, survey: Map<string, SurveyRow>): number {
  const row = survey.get(entity.name);
  assert(row, `${entity.name} is missing from popularity.csv`);
  assert(entity.stars, `${entity.name} is missing a star rating`);
  return characterSurveyWeight(row.owned, row.usage, row.votes, entity.stars);
}

function gearVersionSpan(entities: CatalogEntity[]): VersionSpan {
  const values = entities
    .map((entity) => versionNumber(entity.version))
    .filter((value): value is number => value !== undefined);
  assert(values.length > 1, "Gear needs a release-version span");
  return { min: Math.min(...values), max: Math.max(...values) };
}

function gearWeight(entity: CatalogEntity, span: VersionSpan): number {
  return gearPriorWeight(entity.stars ?? 1, entity.version, entity.name, span);
}

function withArticle(phrase: string): string {
  const article = /^[aeiou]/i.test(phrase) ? "an" : "a";
  return `Name ${article} ${phrase}`;
}

function characterPrompt(filters: Record<string, string>): string {
  const { stars, element, weaponType, region } = filters;
  if (!element && !weaponType && !stars) return withArticle(`character from ${region}`);

  const bits = [stars ? `${stars}-star` : "", element ?? "", weaponType ?? ""].filter(Boolean);
  const noun = weaponType ? `${bits.join(" ")} user` : `${bits.join(" ")} character`;
  return region ? withArticle(`${noun} from ${region}`) : withArticle(noun);
}

function weaponPrompt(filters: Record<string, string>): string {
  const { stars, weaponType } = filters;
  if (stars && weaponType) return withArticle(`${stars}-star ${weaponType}`);
  if (weaponType) return withArticle(weaponType);
  return withArticle(`${stars}-star weapon`);
}

function artifactPrompt(filters: Record<string, string>): string {
  return withArticle(`${filters.stars}-star artifact set`);
}

function categoryKey(type: EntityType, filters: Record<string, string>): string {
  const parts = Object.keys(filters)
    .sort()
    .map((key) => `${key}=${filters[key]}`);
  return [type, ...parts].join("|");
}

function valuesOf(entities: CatalogEntity[], field: string): string[] {
  return [...new Set(entities.flatMap((entity) => fieldValues(entity, field)))].sort();
}

function matches(entity: CatalogEntity, filters: Record<string, string>): boolean {
  return entityMatches(entity, filters);
}

type WeightOverrides = Record<string, Record<string, number>>;

function categoryWeights(
  categoryKey: string,
  answers: CatalogEntity[],
  weightOf: (entity: CatalogEntity) => number,
  overrides: WeightOverrides,
): Record<string, number> {
  const multipliers = overrides[categoryKey] ?? {};
  const ids = new Set(answers.map((answer) => answer.id));
  for (const id of Object.keys(multipliers)) {
    assert(ids.has(id), `weights.json lists ${id} for ${categoryKey}, which is not an answer in that category`);
  }
  const weights: Record<string, number> = {};
  for (const answer of answers) weights[answer.id] = weightOf(answer);
  return multiplyWeights(weights, multipliers);
}

function buildCategories(
  type: EntityType,
  entities: CatalogEntity[],
  fields: string[],
  promptFor: (filters: Record<string, string>) => string,
  weightOf: (entity: CatalogEntity) => number,
  weightOverrides: WeightOverrides,
): CategoryTemplate[] {
  const filtersList: Array<Record<string, string>> = [];

  for (const field of fields) {
    for (const value of valuesOf(entities, field)) filtersList.push({ [field]: value });
  }
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      for (const left of valuesOf(entities, fields[i])) {
        for (const right of valuesOf(entities, fields[j])) {
          filtersList.push({ [fields[i]]: left, [fields[j]]: right });
        }
      }
    }
  }

  const categories: CategoryTemplate[] = [];
  for (const filters of filtersList) {
    const answers = entities.filter((entity) => matches(entity, filters));
    if (answers.length < MIN_CATEGORY_SIZE) continue;

    const key = categoryKey(type, filters);
    const weights = categoryWeights(key, answers, weightOf, weightOverrides);
    const priorShares = sharesFromWeights(weights);
    categories.push({
      key,
      entityType: type,
      prompt: promptFor(filters),
      answerIds: answers.map((answer) => answer.id).sort(),
      priorShares,
      skewed: priorIsSkewed(weights),
      skewRatio: Math.round(skewRatio(weights) * 1000) / 1000,
      bonusAnswerIds: [],
    });
  }

  categories.sort((a, b) => a.key.localeCompare(b.key));
  return categories;
}

interface AliasBuilder {
  add(id: string, form: string): void;
  finish(): AliasIndex;
}

function createAliasBuilder(entities: CatalogEntity[]): AliasBuilder {
  const canonical = new Map(entities.map((entity) => [entity.id, normalizeAlias(entity.name)]));
  const byId = new Map<string, string[]>();

  return {
    add(id: string, form: string) {
      const display = form.trim().replace(/\s+/g, " ");
      const key = normalizeAlias(display);
      if (!display || key.length < 2 || key === canonical.get(id)) return;
      const current = byId.get(id) ?? [];
      if (current.some((existing) => normalizeAlias(existing) === key)) return;
      current.push(display);
      byId.set(id, current);
    },
    finish() {
      const aliases: AliasIndex = {};
      for (const id of [...byId.keys()].sort()) {
        const names = byId.get(id);
        if (names && names.length > 0) aliases[id] = [...names].sort((a, b) => a.localeCompare(b));
      }
      return aliases;
    },
  };
}

function indexAltNames(builder: AliasBuilder, entities: CatalogEntity[], folder: "characters" | "weapons" | "artifacts"): void {
  const byFilename = new Map(entities.map((entity) => [entity.id.split(":")[1], entity.id]));
  for (const altname of altnames.getAltNamesList("English", folder)) {
    const filename = altnames.getFilename("English", folder, altname);
    const id = filename ? byFilename.get(filename) : undefined;
    if (id) builder.add(id, altname);
  }
}

function indexUniqueTokens(builder: AliasBuilder, entities: CatalogEntity[]): void {
  const owner = new Map<string, { id: string; display: string } | "ambiguous">();
  for (const entity of entities) {
    for (const token of entity.name.split(/\s+/)) {
      if (token.length < 4 || TOKEN_STOP.has(token.toLowerCase())) continue;
      const key = normalizeAlias(token);
      const current = owner.get(key);
      if (!current) owner.set(key, { id: entity.id, display: token });
      else if (current !== "ambiguous" && current.id !== entity.id) owner.set(key, "ambiguous");
    }
  }
  for (const entry of owner.values()) {
    if (entry === "ambiguous") continue;
    builder.add(entry.id, entry.display);
  }
}

function indexPieces(builder: AliasBuilder, artifacts: Array<{ entity: CatalogEntity; pieces: string[] }>): void {
  for (const { entity, pieces } of artifacts) {
    for (const piece of pieces) builder.add(entity.id, piece);
  }
}

interface ExtraCategory {
  key: string;
  prompt: string;
  answerIds: string[];
  /** Hand weights for existing answers in this category only. */
  weights: Record<string, number>;
}

/** An answer defined in extra-categories.json rather than imported from genshin-db. */
interface ExtraAnswer {
  entity: CatalogEntity;
  aliases: string[];
}

/** type:slug, lowercase. The type is the part before the colon. */
const EXTRA_ANSWER_ID = /^([a-z][a-z0-9-]*):[a-z0-9][a-z0-9-]*$/;

type ExceptionIndex = Record<string, Partial<Record<ExceptionField, string[]>>>;

/** Extra field values. Missing file means none. The build never writes this file. */
function loadExceptions(): ExceptionIndex {
  const file = path.join(dataDir, "exceptions.json");
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "exceptions.json must be an object of entity id to field values",
  );

  const exceptions: ExceptionIndex = {};
  const allowed = new Set<string>(EXCEPTION_FIELDS);
  for (const [id, fields] of Object.entries(parsed as Record<string, unknown>)) {
    assert(fields !== null && typeof fields === "object" && !Array.isArray(fields), `${id} in exceptions.json must be an object of fields`);
    const entry: Partial<Record<ExceptionField, string[]>> = {};
    for (const [field, values] of Object.entries(fields as Record<string, unknown>)) {
      assert(allowed.has(field), `${id} in exceptions.json uses ${field}, which is not an exception field`);
      assert(Array.isArray(values) && values.length > 0, `${id} needs at least one ${field} exception`);
      const seen = new Set<string>();
      for (const value of values) {
        assert(typeof value === "string", `${id} has a non-string ${field} exception`);
        const trimmed = value.trim();
        assert(trimmed.length > 0, `${id} has an empty ${field} exception`);
        assert(!seen.has(trimmed), `${id} lists ${field} ${trimmed} twice`);
        seen.add(trimmed);
      }
      entry[field as ExceptionField] = [...seen];
    }
    assert(Object.keys(entry).length > 0, `${id} in exceptions.json has no exception fields`);
    exceptions[id] = entry;
  }
  return exceptions;
}

function applyExceptions(entities: CatalogEntity[], exceptions: ExceptionIndex): void {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  for (const [id, fields] of Object.entries(exceptions)) {
    const entity = byId.get(id);
    assert(entity, `exceptions.json lists ${id}, which is not a catalog entity`);
    for (const [field, values] of Object.entries(fields) as Array<[ExceptionField, string[]]>) {
      const primary = fieldValues(entity, field);
      for (const value of values) {
        assert(!primary.includes(value), `${id} already has ${field} ${value}`);
      }
    }
    entity.exceptions = fields;
  }
}

/**
 * Hand-written prompts. Missing file means none. The build never writes this file.
 * Each entry in a category's answers is one of:
 *   "character:albedo"                         an existing answer at its usual weight
 *   { id, weight }                             an existing answer with a hand weight for this category only
 *   { id, name, weight, aliases? }             a new answer; weight is its usual weight
 * A defined answer can be listed by id in other categories.
 * Hand weights and computed weights are on different scales, so one category cannot mix them.
 */
function loadExtraCategories(): { categories: ExtraCategory[]; answers: ExtraAnswer[] } {
  const file = path.join(dataDir, "extra-categories.json");
  if (!existsSync(file)) return { categories: [], answers: [] };
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "extra-categories.json must be an object with a categories array",
  );
  const rows = (parsed as { categories?: unknown }).categories;
  assert(Array.isArray(rows), "extra-categories.json must have a categories array");

  const answers = new Map<string, ExtraAnswer>();
  const categories = rows.map((entry, index) => {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `categories[${index}] must be an object`);
    const row = entry as Record<string, unknown>;
    assert(typeof row.key === "string" && row.key.length > 0, `categories[${index}] needs a key`);
    assert(typeof row.prompt === "string" && row.prompt.length > 0, `${row.key} needs a prompt`);
    assert(Array.isArray(row.answers), `${row.key} needs an answers list`);

    const weights: Record<string, number> = {};
    const answerIds = row.answers.map((item, i) => {
      const where = `${row.key} answers[${i}]`;
      if (typeof item === "string") {
        assert(item.length > 0, `${where} is an empty id`);
        return item;
      }
      if (item !== null && typeof item === "object" && !("name" in item)) {
        const ref = item as Record<string, unknown>;
        assert(typeof ref.id === "string" && ref.id.length > 0, `${where} needs an id`);
        assert(isPositiveWeight(ref.weight), `${where} lists ${ref.id} as an object, so it needs a positive weight`);
        assert(!("aliases" in ref), `${ref.id} already exists. Put its aliases in extra-aliases.json.`);
        weights[ref.id] = ref.weight;
        return ref.id;
      }
      const answer = parseExtraAnswer(item, where);
      assert(!answers.has(answer.entity.id), `extra-categories.json defines ${answer.entity.id} twice. List it by id after the first time.`);
      answers.set(answer.entity.id, answer);
      return answer.entity.id;
    });
    return { key: row.key, prompt: row.prompt, answerIds, weights };
  });
  return { categories, answers: [...answers.values()] };
}

function parseExtraAnswer(item: unknown, where: string): ExtraAnswer {
  assert(item !== null && typeof item === "object" && !Array.isArray(item), `${where} must be an id string or an answer object`);
  const row = item as Record<string, unknown>;
  assert(typeof row.id === "string", `${where} needs an id`);
  const match = EXTRA_ANSWER_ID.exec(row.id);
  assert(match, `${where} id ${row.id} must look like type:slug, lowercase, such as title:honorary-knight`);
  assert(typeof row.name === "string" && row.name.trim().length > 0, `${row.id} needs a name`);
  assert(isPositiveWeight(row.weight), `${row.id} needs a positive weight`);
  const aliases = row.aliases ?? [];
  assert(Array.isArray(aliases), `${row.id} aliases must be a list of strings`);
  for (const alias of aliases) assert(typeof alias === "string", `${row.id} has a non-string alias`);

  return {
    entity: { id: row.id, type: match[1], name: row.name.trim(), weight: row.weight },
    aliases: aliases as string[],
  };
}

function isPositiveWeight(value: unknown): value is number {
  return typeof value === "number" && value > 0 && Number.isFinite(value);
}

/** Add defined answers to the catalog. They cannot reuse a genshin-db id. */
function addExtraAnswers(entities: CatalogEntity[], answers: ExtraAnswer[]): void {
  const ids = new Set(entities.map((entity) => entity.id));
  for (const { entity } of answers) {
    assert(!ids.has(entity.id), `extra-categories.json defines ${entity.id}, which genshin-db already has. List it as an id string.`);
    entities.push(entity);
  }
}

function buildExtraCategories(
  extra: ExtraCategory[],
  entities: CatalogEntity[],
  weightOf: (entity: CatalogEntity) => number,
  weightOverrides: WeightOverrides,
): CategoryTemplate[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const seenKeys = new Set<string>();
  const categories: CategoryTemplate[] = [];

  for (const entry of extra) {
    assert(!seenKeys.has(entry.key), `extra-categories.json lists ${entry.key} twice`);
    seenKeys.add(entry.key);
    const unique = new Set(entry.answerIds);
    assert(unique.size === entry.answerIds.length, `${entry.key} repeats an answer id`);
    assert(
      entry.answerIds.length >= MIN_CATEGORY_SIZE,
      `${entry.key} has ${entry.answerIds.length} answers`,
    );

    const answers = entry.answerIds.map((id) => {
      const entity = byId.get(id);
      assert(entity, `${entry.key} lists ${id}, which is neither a catalog entity nor defined in extra-categories.json`);
      return entity;
    });
    const types = new Set(answers.map((answer) => answer.type));
    const handWeight = (entity: CatalogEntity) => entry.weights[entity.id] ?? entity.weight;
    const handWeighted = answers.filter((answer) => handWeight(answer) !== undefined).length;
    assert(
      handWeighted === 0 || handWeighted === answers.length,
      `${entry.key} mixes hand weights with computed weights. List the other answers as { "id": ..., "weight": ... }.`,
    );

    const weights = categoryWeights(entry.key, answers, (entity) => handWeight(entity) ?? weightOf(entity), weightOverrides);
    const priorShares = sharesFromWeights(weights);
    categories.push({
      key: entry.key,
      entityType: types.size === 1 ? answers[0].type : "mixed",
      prompt: entry.prompt,
      answerIds: [...entry.answerIds].sort(),
      priorShares,
      skewed: priorIsSkewed(weights),
      skewRatio: Math.round(skewRatio(weights) * 1000) / 1000,
      bonusAnswerIds: [],
    });
  }

  return categories;
}

/** Per-category multipliers. Missing file means none. The build never writes this file. */
function loadWeights(): WeightOverrides {
  const file = path.join(dataDir, "weights.json");
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "weights.json must be an object of category key to answer multipliers",
  );

  const overrides: WeightOverrides = {};
  for (const [categoryKey, answers] of Object.entries(parsed as Record<string, unknown>)) {
    assert(categoryKey.length > 0, "weights.json has an empty category key");
    assert(
      answers !== null && typeof answers === "object" && !Array.isArray(answers),
      `${categoryKey} in weights.json must be an object of answer id to multiplier`,
    );
    const multipliers: Record<string, number> = {};
    for (const [id, multiplier] of Object.entries(answers as Record<string, unknown>)) {
      assert(id.length > 0, `${categoryKey} in weights.json has an empty answer id`);
      assert(
        typeof multiplier === "number" && multiplier > 0 && Number.isFinite(multiplier),
        `${categoryKey} weight for ${id} must be a positive number`,
      );
      multipliers[id] = multiplier;
    }
    assert(Object.keys(multipliers).length > 0, `${categoryKey} in weights.json has no answer weights`);
    overrides[categoryKey] = multipliers;
  }
  return overrides;
}

/** Per-category answers worth 100 points. Missing file means none. The build never writes this file. */
function loadBonusAnswers(): Record<string, string[]> {
  const file = path.join(dataDir, "bonus-answers.json");
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "bonus-answers.json must be an object of category key to answer id lists",
  );

  const bonus: Record<string, string[]> = {};
  for (const [categoryKey, ids] of Object.entries(parsed as Record<string, unknown>)) {
    assert(Array.isArray(ids) && ids.length > 0, `${categoryKey} in bonus-answers.json must list answer ids`);
    for (const id of ids) {
      assert(typeof id === "string" && id.length > 0, `${categoryKey} in bonus-answers.json has a non-string id`);
    }
    assert(new Set(ids).size === ids.length, `${categoryKey} in bonus-answers.json repeats an answer id`);
    bonus[categoryKey] = ids;
  }
  return bonus;
}

function applyBonusAnswers(categories: CategoryTemplate[], bonus: Record<string, string[]>): void {
  const byKey = new Map(categories.map((category) => [category.key, category]));
  for (const [categoryKey, ids] of Object.entries(bonus)) {
    const category = byKey.get(categoryKey);
    assert(category, `bonus-answers.json lists ${categoryKey}, which is not a category`);
    for (const id of ids) {
      assert(category.answerIds.includes(id), `bonus-answers.json lists ${id}, which is not an answer to ${categoryKey}`);
    }
    category.bonusAnswerIds = [...ids].sort();
  }
}

/** Hand-written aliases. Missing file means none. The build never writes this file. */
function loadExtraAliases(): AliasIndex {
  const file = path.join(dataDir, "extra-aliases.json");
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "extra-aliases.json must be an object of entity id to alias lists",
  );
  const extra: AliasIndex = {};
  for (const [id, names] of Object.entries(parsed as Record<string, unknown>)) {
    assert(Array.isArray(names), `${id} in extra-aliases.json must list alias strings`);
    for (const name of names) {
      assert(typeof name === "string", `${id} in extra-aliases.json has a non-string alias`);
    }
    extra[id] = names;
  }
  return extra;
}

function addExtraAliases(builder: AliasBuilder, extra: AliasIndex, entities: CatalogEntity[]): void {
  const ids = new Set(entities.map((entity) => entity.id));
  for (const [id, names] of Object.entries(extra)) {
    assert(ids.has(id), `extra-aliases.json lists ${id}, which is not a catalog entity`);
    for (const name of names) builder.add(id, name);
  }
}

function assertExtraAliasesKept(extra: AliasIndex, aliases: AliasIndex): void {
  for (const [id, names] of Object.entries(extra)) {
    const stored = new Set((aliases[id] ?? []).map((name) => normalizeAlias(name)));
    for (const name of names) {
      const key = normalizeAlias(name.trim().replace(/\s+/g, " "));
      assert(
        stored.has(key),
        `extra alias "${name}" for ${id} was dropped. It matches that entity's name, matches another alias, or is shorter than 2 characters.`,
      );
    }
  }
}

function sharesSumToOne(shares: Record<string, number>): boolean {
  const sum = Object.values(shares).reduce((total, share) => total + share, 0);
  return Math.abs(sum - 1) < 1e-9 && Object.values(shares).every((share) => share > 0);
}

function main(): void {
  const survey = loadSurvey();
  const characters = characterEntities();
  const weapons = weaponEntities();
  const artifactRows = artifactEntities();
  const artifacts = artifactRows.map((row) => row.entity);
  const entities: CatalogEntity[] = [...characters, ...weapons, ...artifacts];
  const extra = loadExtraCategories();
  addExtraAnswers(entities, extra.answers);
  applyExceptions(entities, loadExceptions());

  const characterNames = new Set(characters.map((entity) => entity.name));
  for (const name of survey.keys()) {
    assert(characterNames.has(name), `popularity.csv lists ${name}, which is not a catalog character`);
  }

  const span = gearVersionSpan([...weapons, ...artifacts]);
  const weightGear = (entity: CatalogEntity) => gearWeight(entity, span);
  const weightEntity = (entity: CatalogEntity) =>
    entity.weight ?? (entity.type === "character" ? characterWeight(entity, survey) : weightGear(entity));
  const weightOverrides = loadWeights();
  const generated = [
    ...buildCategories(
      "character",
      characters,
      ["element", "weaponType", "region", "stars"],
      characterPrompt,
      (entity) => characterWeight(entity, survey),
      weightOverrides,
    ),
    ...buildCategories("weapon", weapons, ["stars", "weaponType"], weaponPrompt, weightGear, weightOverrides),
    ...buildCategories("artifact", artifacts, ["stars"], artifactPrompt, weightGear, weightOverrides),
  ];
  const extraCategories = buildExtraCategories(extra.categories, entities, weightEntity, weightOverrides);
  const generatedKeys = new Set(generated.map((category) => category.key));
  for (const category of extraCategories) {
    assert(!generatedKeys.has(category.key), `extra-categories.json reuses ${category.key}, which the filters already emit`);
  }
  const categories = [...generated, ...extraCategories].sort((a, b) => a.key.localeCompare(b.key));
  const categoryKeys = new Set(categories.map((category) => category.key));
  for (const key of Object.keys(weightOverrides)) {
    assert(categoryKeys.has(key), `weights.json lists ${key}, which is not a category`);
  }
  applyBonusAnswers(categories, loadBonusAnswers());

  const extraAliases = loadExtraAliases();
  for (const { entity, aliases: names } of extra.answers) {
    if (names.length > 0) extraAliases[entity.id] = [...(extraAliases[entity.id] ?? []), ...names];
  }
  const builder = createAliasBuilder(entities);
  indexAltNames(builder, characters, "characters");
  indexUniqueTokens(builder, characters);
  for (const form of ["Aether", "Lumine"]) builder.add("character:traveler", form);
  indexPieces(builder, artifactRows);
  addExtraAliases(builder, extraAliases, entities);
  const aliases = builder.finish();
  assertExtraAliasesKept(extraAliases, aliases);

  assert(aliases["character:hutao"] === undefined, "Hu Tao needs no stored alias");
  assert(normalizeAlias("Hu Tao") === normalizeAlias("Hutao"), "Hutao should match Hu Tao by normalization");
  assert(aliases["character:tartaglia"]?.includes("Childe"), "Childe should stay as an alias");
  assert(aliases["character:raidenshogun"]?.includes("Baal"), "Baal should stay as an alias");
  assert(aliases["character:traveler"]?.includes("Aether") && aliases["character:traveler"]?.includes("Lumine"), "Traveler is missing Aether or Lumine");
  for (const [id, names] of Object.entries(aliases)) {
    const entity = entities.find((candidate) => candidate.id === id);
    assert(entity, `Alias entry ${id} has no entity`);
    const canonical = normalizeAlias(entity.name);
    const seen = new Set<string>();
    for (const name of names) {
      const key = normalizeAlias(name);
      assert(key !== canonical && !seen.has(key), `${id} stores a redundant alias ${name}`);
      seen.add(key);
    }
  }

  const pyro = categories.find((category) => category.key === "character|element=Pyro");
  assert(pyro, "Missing the Pyro character category");
  const bennett = pyro.priorShares["character:bennett"];
  const hutao = pyro.priorShares["character:hutao"];
  const arlecchino = pyro.priorShares["character:arlecchino"];
  const chevreuse = pyro.priorShares["character:chevreuse"];
  assert(bennett !== undefined && hutao !== undefined, "Pyro prior is missing Bennett or Hu Tao");
  assert(arlecchino !== undefined && chevreuse !== undefined, "Pyro prior is missing Arlecchino or Chevreuse");
  assert(bennett > hutao, "Bennett should be a more expected Pyro answer than Hu Tao");
  assert(arlecchino > chevreuse, "Arlecchino should be a more expected Pyro answer than Chevreuse");

  for (const category of categories) {
    assert(
      category.answerIds.length >= MIN_CATEGORY_SIZE,
      `${category.key} has ${category.answerIds.length} answers`,
    );
    assert(sharesSumToOne(category.priorShares), `${category.key} prior shares do not sum to 1`);
    assert(
      category.answerIds.every((id) => category.priorShares[id] !== undefined),
      `${category.key} is missing a prior share`,
    );
    assert(
      fillsRequiredPoints(pointsByAnswer(category.priorShares, category.bonusAnswerIds)),
      `${category.key} needs at least 4 distinct prior shares outside its bonus answers to fill the point tiers`,
    );
  }

  const sourcePackage = JSON.parse(readFileSync(require.resolve("genshin-db/package.json"), "utf8")) as {
    version: string;
  };
  const catalog = {
    source: "genshin-db",
    sourceVersion: sourcePackage.version,
    scope: [...new Set(entities.map((entity) => entity.type))],
    entities,
  };

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(path.join(dataDir, "aliases.json"), JSON.stringify(aliases, null, 2) + "\n");
  writeFileSync(path.join(dataDir, "categories.json"), JSON.stringify({ categories }, null, 2) + "\n");

  const skewed = categories.filter((category) => category.skewed).length;
  const counts = {
    character: characters.length,
    weapon: weapons.length,
    artifact: artifacts.length,
  };
  const topPyro = Object.entries(pyro.priorShares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, share]) => `${characters.find((entity) => entity.id === id)?.name} ${share.toFixed(3)}`);

  console.log(`entities ${JSON.stringify(counts)}`);
  console.log(`categories ${categories.length} (${skewed} skewed, ${categories.length - skewed} flat)`);
  console.log(`pyro top ${topPyro.join(", ")}`);
  console.log(`example ${categories.find((category) => category.prompt === "Name a Claymore user from Liyue")?.key ?? "claymore+liyue below the size cutoff"}`);
}

main();
