# Daily questions

This file is a scratch list. The catalog build does not read it. A prompt is playable only after `npm run build:catalog` writes it into `data/categories.json`.

Ready prompts below are the categories already in that file. The daily picker can draw a skewed prior immediately. A flat prior waits until 80 real answers.

## Ready

### Characters

- Name an Anemo characters
- Name a 5-star Anemo character
- Name an Anemo Catalyst user
- Name a Cryo character
- Name a 5-star Cryo character
- Name a Dendro character
- Name a 5-star Dendro character
- Name an Electro character
- Name a 5-star Electro character
- Name a Geo character
- Name a 5-star Geo character
- Name a Hydro character
- Name a 5-star Hydro character
- Name a Pyro character
- Name a 5-star Pyro character
- Name a character from Fontaine
- Name a 5-star character from Fontaine
- Name a character from Inazuma
- Name a 5-star character from Inazuma
- Name a character from Liyue
- Name a 5-star character from Liyue
- Name a character from Mondstadt
- Name a 5-star character from Mondstadt
- Name a character from Natlan
- Name a character from Nod-Krai
- Name a character from Sumeru
- Name a 5-star Bow user
- Name a 5-star Catalyst user
- Name a 5-star Claymore user
- Name a 5-star Polearm user
- Name a 5-star Sword user
- Name a Bow user
- Name a Catalyst user
- Name a Claymore user
- Name a Polearm user
- Name a Sword user

### Weapons

- Name a 4-star Bow
- Name a 4-star Catalyst
- Name a 4-star Claymore
- Name a 4-star Polearm
- Name a 4-star Sword
- Name a 5-star Bow
- Name a 5-star Catalyst
- Name a 5-star Claymore
- Name a 5-star Polearm
- Name a 5-star Sword
- Name a Bow
- Name a Catalyst
- Name a Claymore
- Name a Polearm
- Name a Sword

### Artifacts

- Name a 5-star artifact set

### In the catalog, prior is flat

These have an accepted set, and every answer is about equally likely. The picker skips them until 80 people have answered.

- Name a 4-star Cryo character
- Name a 4-star Anemo character
- Name a 4-star Electro character
- Name a 4-star Pyro character
- Name a 4-star character from Liyue
- Name a 4-star character from Mondstadt
- Name a 4-star character
- Name a 4-star Bow user
- Name a 4-star Catalyst user
- Name a 4-star Claymore user
- Name a 4-star Polearm user
- Name a 4-star Sword user
- Name a 3-star weapon
- Name a 4-star artifact set

## Unimplemented

Add prompts here. Any hand-made question goes in `data/extra-categories.json` as a key, a prompt, and at least 8 answers. An answer can be an existing id (the build fills the weight), an existing id with a hand weight, or a brand-new answer with its own id, name, weight, and aliases.

A category that is not ready yet can sit in that file with `"draft": true`. The build skips it — no size or weight checks, nothing in `categories.json`, and answers it defines stay out of the catalog — until the flag is removed.

- Name a 4-star food
- Name a viewpoint in Inazuma
- Name a title/alias of the Traveler
- Name a quest
- Name a soundtrack track
- Name an enemy
- Name an achievement
- Name a namecard
- Name a character that starts with C
- Name a character that was playable after 3.0
- Name a character whose name is longer than 5 letters
- Name a character who wears heels 
- Name a character who has detached sleeves
- Name a character who has split hair
- Name a character whose birthday is within January - June
- Name a character's last name (like Kamisato)
- Name a type of enemy
- Name a humanoid enemy
- Name an artifact with a possessive ('s)