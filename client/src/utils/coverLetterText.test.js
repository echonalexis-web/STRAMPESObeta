import test from "node:test";
import assert from "node:assert/strict";
import { buildLetterParagraphs, hasPlaceholder, salutationFor, LETTER_TONE_LINES } from "./coverLetterText.js";
import { buildProfileCoverLetterReplacements } from "./coverLetterDerivation.js";

const TONES = Object.keys(LETTER_TONE_LINES);
const text = (tone, replacements) => buildLetterParagraphs(tone, replacements).join("\n\n");

test("with an empty profile no tone has a bracketed placeholder, a raw {token} or a doubled phrase", () => {
  for (const tone of TONES) {
    const letter = text(tone, { "{position}": "Service Crew", "{company}": "Acme Foods" });
    assert.ok(letter.length > 40, tone);
    assert.equal(hasPlaceholder(letter), false, tone);
    assert.doesNotMatch(letter, /\{[a-z_]+\}/, tone);
    assert.doesNotMatch(letter, /my previous role as my previous role/i, tone);
    assert.doesNotMatch(letter, /\byears years\b/i, tone);
  }
});

test("a sentence that needs data the profile lacks is left out, not filled with a placeholder", () => {
  const bare = text("professional", { "{position}": "Cook", "{company}": "Acme" });
  assert.doesNotMatch(bare, /previous role/i);
  assert.doesNotMatch(bare, /background in/i);
  assert.doesNotMatch(bare, /proficient in/i);
  const full = text("professional", {
    "{position}": "Cook", "{company}": "Acme", "{field}": "Food service", "{previous_role}": "Kitchen helper",
    "{skills}": "Knife skills, Food safety", "{key_skills}": "Knife skills, Food safety",
  });
  assert.match(full, /In my previous role as Kitchen helper, I developed strong skills in Knife skills, Food safety\./);
  assert.match(full, /background in Food service/);
});

test("the job's exact title and the employer's name are used, and 'Service crew' is not reworded", () => {
  const letter = text("professional", { "{position}": "Service Crew", "{company}": "Acme Foods" });
  assert.match(letter, /the Service Crew position at Acme Foods/);
});

test("the enthusiastic greeting does not say 'Hi your company Team' when the company is unknown", () => {
  const letter = text("enthusiastic", { "{position}": "Cook" });
  assert.doesNotMatch(letter, /Hi your company Team/);
});

test("the first-time tone never claims a previous role or years of experience", () => {
  const letter = text("firstTime", { "{position}": "Clerk", "{company}": "Acme", "{previous_role}": "Cashier", "{years}": "3–5 years" });
  assert.doesNotMatch(letter, /previous role|years of experience|Cashier/i);
});

test("years: 'Fresh Graduate' is not turned into a number of years", () => {
  const replacements = buildProfileCoverLetterReplacements({ workExperience: "Fresh Graduate", skills: ["a", "b", "c"] }, { workHistory: [] });
  assert.equal(replacements["{years}"], undefined);
  const withYears = buildProfileCoverLetterReplacements({ workExperience: "1–3 years" }, {});
  assert.equal(withYears["{years}"], "1–3 years");
  const letter = text("concise", { "{position}": "Clerk", "{company}": "Acme", "{field}": "Admin", ...withYears });
  assert.match(letter, /I bring 1–3 years of experience in Admin\./);
});

test("the previous role comes from the newest work history entry", () => {
  const replacements = buildProfileCoverLetterReplacements({}, { workHistory: [{ position: "Cashier" }, { position: "Helper" }] });
  assert.equal(replacements["{previous_role}"], "Cashier");
});

test("salutation: the hiring contact's name when given, else Hiring Manager; no titles are guessed", () => {
  assert.equal(salutationFor("  Maria   Santos "), "Dear Maria Santos,");
  assert.equal(salutationFor(""), "Dear Hiring Manager,");
  assert.equal(salutationFor(null), "Dear Hiring Manager,");
  assert.equal(salutationFor(undefined), "Dear Hiring Manager,");
});

test("hasPlaceholder spots a leftover [..] and ignores ordinary text", () => {
  assert.equal(hasPlaceholder("I did [your notable achievement] last year"), true);
  assert.equal(hasPlaceholder("I did well. See Appendix (A)."), false);
  assert.equal(hasPlaceholder(""), false);
});
