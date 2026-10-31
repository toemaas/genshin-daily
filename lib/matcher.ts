/**
 * Resolves typed text to one answer of the current prompt.
 * Only that prompt's answers can match, so the same name can mean different answers on different prompts:
 * "Honorary Knight" is the Traveler on a character prompt and its own answer on a title prompt.
 */
import { normalizeAlias, type AliasIndex, type CatalogEntity } from "./catalog.ts";

export type MatchResult =
  /** typo is true when the text was corrected to the answer, not typed exactly. */
  | { status: "matched"; answerId: string; typo: boolean }
  /** The text names several of this prompt's answers exactly, such as an alias two answers share. */
  | { status: "ambiguous"; answerIds: string[] }
  /** The text names a catalog entry exactly, but none of this prompt's answers. Scores 0 and is not counted. */
  | { status: "off-prompt"; entityIds: string[] }
  | { status: "unknown" };

export type RejectReason = Exclude<MatchResult["status"], "matched">;

/**
 * What the answer API sends back for one attempt.
 * Only an accepted attempt is recorded, counted toward rarity, and moves the player to the next prompt.
 * A rejected attempt keeps the player on the prompt to try again until the timer runs out.
 * It carries no answer ids, so the browser never learns which answers a prompt accepts.
 */
export type AttemptFeedback =
  | { accepted: true; answerId: string; typo: boolean }
  | { accepted: false; reason: RejectReason; message: string };

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  ambiguous: "Be more specific",
  "off-prompt": "Doesn't count for this prompt",
  unknown: "Not recognized. Check the spelling",
};

export function attemptFeedback(result: MatchResult): AttemptFeedback {
  if (result.status === "matched") return { accepted: true, answerId: result.answerId, typo: result.typo };
  return { accepted: false, reason: result.status, message: REJECT_MESSAGES[result.status] };
}

/** Every normalized name and alias, both ways. Build once from the catalog and reuse for every prompt. */
export interface NameIndex {
  formsById: Map<string, string[]>;
  idsByForm: Map<string, string[]>;
}

export function buildNameIndex(entities: ReadonlyArray<Pick<CatalogEntity, "id" | "name">>, aliases: AliasIndex): NameIndex {
  const formsById = new Map<string, string[]>();
  const idsByForm = new Map<string, string[]>();
  for (const entity of entities) {
    const forms = [...new Set([entity.name, ...(aliases[entity.id] ?? [])].map(normalizeAlias))].filter(Boolean);
    formsById.set(entity.id, forms);
    for (const form of forms) idsByForm.set(form, [...(idsByForm.get(form) ?? []), entity.id]);
  }
  for (const id of Object.keys(aliases)) {
    if (!formsById.has(id)) throw new Error(`Aliases list ${id}, which is not in the catalog`);
  }
  return { formsById, idsByForm };
}

/**
 * Edits a typo may contain, by the length of the name or alias it is compared to.
 * Short names get none, because one edit turns most short names into other real names.
 */
export function typoAllowance(formLength: number): number {
  if (formLength < 5) return 0;
  if (formLength < 9) return 1;
  return 2;
}

/**
 * Exact name or alias first. Then a near typo, only when:
 * - exactly one answer is closest within its allowance. A tie between answers matches nothing;
 * - no name outside the prompt is as close, so a misspelled wrong answer is never corrected into a right one.
 */
export function matchAnswer(text: string, answerIds: readonly string[], index: NameIndex): MatchResult {
  const typed = normalizeAlias(text);
  if (!typed) return { status: "unknown" };

  for (const id of answerIds) {
    if (!index.formsById.has(id)) throw new Error(`Answer ${id} is not in the catalog`);
  }
  const inPrompt = new Set(answerIds);
  const exactIds = index.idsByForm.get(typed) ?? [];
  const exactHere = [...new Set(exactIds.filter((id) => inPrompt.has(id)))].sort();
  if (exactHere.length === 1) return { status: "matched", answerId: exactHere[0], typo: false };
  if (exactHere.length > 1) return { status: "ambiguous", answerIds: exactHere };
  if (exactIds.length > 0) return { status: "off-prompt", entityIds: [...new Set(exactIds)].sort() };

  let best = Infinity;
  let closest: string[] = [];
  for (const id of answerIds) {
    for (const form of index.formsById.get(id)!) {
      const allowance = typoAllowance(form.length);
      if (allowance === 0) continue;
      const distance = editDistance(typed, form, allowance);
      if (distance > allowance) continue;
      if (distance < best) {
        best = distance;
        closest = [id];
      } else if (distance === best && !closest.includes(id)) {
        closest.push(id);
      }
    }
  }
  if (closest.length !== 1 || closerElsewhere(typed, best, inPrompt, index)) return { status: "unknown" };
  return { status: "matched", answerId: closest[0], typo: true };
}

/** A name or alias that no prompt answer has is within distance of the typed text. */
function closerElsewhere(typed: string, distance: number, inPrompt: Set<string>, index: NameIndex): boolean {
  for (const [form, ids] of index.idsByForm) {
    if (ids.some((id) => inPrompt.has(id))) continue;
    if (editDistance(typed, form, distance) <= distance) return true;
  }
  return false;
}

/**
 * Optimal string alignment distance: insert, delete, substitute, or swap two neighbours, each one edit.
 * Stops early and returns limit + 1 once the distance must exceed limit.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let before = new Array<number>(b.length + 1).fill(0);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, before[j - 2] + 1);
      }
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    before = previous;
    previous = current;
  }
  return Math.min(previous[b.length], limit + 1);
}
