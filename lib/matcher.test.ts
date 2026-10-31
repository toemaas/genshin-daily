import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attemptFeedback,
  buildNameIndex,
  editDistance,
  matchAnswer,
  REJECT_MESSAGES,
  typoAllowance,
} from "./matcher.ts";

const index = buildNameIndex(
  [
    { id: "character:hutao", name: "Hu Tao" },
    { id: "character:bennett", name: "Bennett" },
    { id: "character:xiangling", name: "Xiangling" },
    { id: "character:kaeya", name: "Kaeya" },
    { id: "character:kaveh", name: "Kaveh" },
    { id: "character:kamisatoayaka", name: "Kamisato Ayaka" },
    { id: "character:kamisatoayato", name: "Kamisato Ayato" },
    { id: "character:raidenshogun", name: "Raiden Shogun" },
    { id: "character:traveler", name: "Traveler" },
    { id: "title:honorary-knight", name: "Honorary Knight of the Knights of Favonius" },
    { id: "title:outlander", name: "Outlander" },
    { id: "title:hero-of-liyue", name: "The Hero of Liyue" },
    { id: "weapon:ironsting", name: "Iron Sting" },
    { id: "weapon:ironpoint", name: "Iron Point" },
    { id: "weapon:harbinger", name: "Harbinger of Dawn" },
  ],
  {
    "character:traveler": ["Aether", "Outlander", "Honorary Knight of the Knights of Favonius"],
    "character:kamisatoayaka": ["Slumber Party"],
    "character:kamisatoayato": ["Slumber Party"],
    "character:raidenshogun": ["Ei"],
    "title:honorary-knight": ["Honorary Knight"],
  },
);

const pyro = ["character:hutao", "character:bennett", "character:xiangling"];
const cryo = ["character:kaeya", "character:kamisatoayaka"];
const inazuma = ["character:kamisatoayaka", "character:kamisatoayato", "character:raidenshogun"];
const characters = ["character:traveler", "character:kaeya", "character:kaveh"];
const titles = ["title:honorary-knight", "title:outlander", "title:hero-of-liyue"];
const swords = ["weapon:ironsting", "weapon:harbinger"];

const exact = (answerId: string) => ({ status: "matched", answerId, typo: false });
const typo = (answerId: string) => ({ status: "matched", answerId, typo: true });

test("names match through case, spacing, and punctuation", () => {
  for (const text of ["Hu Tao", "hutao", "HU-TAO", "  hu   tao "]) {
    assert.deepEqual(matchAnswer(text, pyro, index), exact("character:hutao"));
  }
});

test("aliases match like names", () => {
  assert.deepEqual(matchAnswer("Ei", inazuma, index), exact("character:raidenshogun"));
});

test("the same text resolves to whichever answer the prompt has", () => {
  const knight = "Honorary Knight of the Knights of Favonius";
  assert.deepEqual(matchAnswer(knight, characters, index), exact("character:traveler"));
  assert.deepEqual(matchAnswer(knight, titles, index), exact("title:honorary-knight"));
  assert.deepEqual(matchAnswer("Outlander", characters, index), exact("character:traveler"));
  assert.deepEqual(matchAnswer("Outlander", titles, index), exact("title:outlander"));
});

test("a real name outside the prompt is off-prompt, not corrected", () => {
  assert.deepEqual(matchAnswer("Kaeya", pyro, index), { status: "off-prompt", entityIds: ["character:kaeya"] });
  assert.deepEqual(matchAnswer("Aether", titles, index), { status: "off-prompt", entityIds: ["character:traveler"] });
  assert.deepEqual(matchAnswer("Honorary Knight", characters, index), {
    status: "off-prompt",
    entityIds: ["title:honorary-knight"],
  });
});

test("an alias two answers share is ambiguous only when both are in the prompt", () => {
  assert.deepEqual(matchAnswer("Slumber Party", inazuma, index), {
    status: "ambiguous",
    answerIds: ["character:kamisatoayaka", "character:kamisatoayato"],
  });
  assert.deepEqual(matchAnswer("Slumber Party", cryo, index), exact("character:kamisatoayaka"));
});

test("near typos are corrected", () => {
  assert.deepEqual(matchAnswer("Benett", pyro, index), typo("character:bennett"));
  assert.deepEqual(matchAnswer("Bnenett", pyro, index), typo("character:bennett"));
  assert.deepEqual(matchAnswer("Xianglin", pyro, index), typo("character:xiangling"));
  assert.deepEqual(matchAnswer("Xaingilng", pyro, index), typo("character:xiangling"));
  assert.deepEqual(matchAnswer("Raiden Shogn", inazuma, index), typo("character:raidenshogun"));
});

test("names and aliases under 5 letters are never typo-corrected", () => {
  assert.deepEqual(matchAnswer("Ea", inazuma, index), { status: "unknown" });
  // Hutao has 5 letters, so it allows one edit, not two.
  assert.deepEqual(matchAnswer("Hu Ta", pyro, index), typo("character:hutao"));
  assert.deepEqual(matchAnswer("Hu T", pyro, index), { status: "unknown" });
});

test("a misspelled wrong answer is not corrected into a right one", () => {
  // Iron Poing is one edit from Iron Point (a polearm) and two from Iron Sting.
  assert.deepEqual(matchAnswer("Iron Poing", swords, index), { status: "unknown" });
  assert.deepEqual(matchAnswer("Iron Stimg", swords, index), typo("weapon:ironsting"));
});

test("a typo equally close to two answers matches neither", () => {
  const twins = buildNameIndex(
    [
      { id: "npc:marcel", name: "Marcel" },
      { id: "npc:marcus", name: "Marcus" },
    ],
    {},
  );
  // One edit from Marcus, two from Marcel: the closer one wins.
  assert.deepEqual(matchAnswer("Marcis", ["npc:marcel", "npc:marcus"], twins), typo("npc:marcus"));
  // One edit from each.
  assert.deepEqual(matchAnswer("Marcul", ["npc:marcel", "npc:marcus"], twins), { status: "unknown" });
});

test("text with nothing to match is unknown", () => {
  for (const text of ["", "   ", "!!!", "胡桃", "Zhongli"]) {
    assert.deepEqual(matchAnswer(text, pyro, index), { status: "unknown" });
  }
});

test("ids missing from the catalog are a bug, not a miss", () => {
  assert.throws(() => matchAnswer("Hu Tao", ["character:nobody"], index), /not in the catalog/);
  assert.throws(() => buildNameIndex([], { "character:nobody": ["X"] }), /not in the catalog/);
});

test("only a matched answer is accepted", () => {
  assert.deepEqual(attemptFeedback(matchAnswer("Benett", pyro, index)), {
    accepted: true,
    answerId: "character:bennett",
    typo: true,
  });
  assert.deepEqual(attemptFeedback(matchAnswer("Slumber Party", inazuma, index)), {
    accepted: false,
    reason: "ambiguous",
    message: "Be more specific",
  });
  assert.deepEqual(attemptFeedback(matchAnswer("Kaeya", pyro, index)), {
    accepted: false,
    reason: "off-prompt",
    message: REJECT_MESSAGES["off-prompt"],
  });
  assert.deepEqual(attemptFeedback(matchAnswer("Zhongli", pyro, index)), {
    accepted: false,
    reason: "unknown",
    message: REJECT_MESSAGES.unknown,
  });
});

test("a rejected attempt reveals no answer ids", () => {
  for (const [text, prompt] of [["Slumber Party", inazuma], ["Kaeya", pyro]] as const) {
    const sent = JSON.stringify(attemptFeedback(matchAnswer(text, prompt, index)));
    assert.ok(!sent.includes("character:"), sent);
  }
});

test("typo allowance grows with name length", () => {
  assert.deepEqual([4, 5, 8, 9, 30].map(typoAllowance), [0, 1, 1, 2, 2]);
});

test("edit distance counts a swap of neighbours as one edit", () => {
  assert.equal(editDistance("bennett", "bnenett", 2), 1);
  assert.equal(editDistance("kitten", "sitting", 5), 3);
  assert.equal(editDistance("kitten", "sitting", 1), 2);
  assert.equal(editDistance("abc", "abcdef", 1), 2);
});
