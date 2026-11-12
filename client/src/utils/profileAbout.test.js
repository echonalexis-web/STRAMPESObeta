import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aboutModel, uniqueLabels } from "./profileAbout.js";

const full = {
  bio: "Hi!\nI am Alexis.",
  positions: ["Administrative Aide", "Clerk"],
  status: "Actively Looking",
  address: "TANZA, BOAC, MARINDUQUE",
  locations: ["Boac", "Japan"],
};

test("blocks come in order: bio, positions and status, address and locations", () => {
  const m = aboutModel({ ...full, isOwner: true });
  assert.equal(m.bio.state, "filled");
  assert.deepEqual(m.rowB.map((c) => c.key), ["positions", "status"]);
  assert.deepEqual(m.rowC.map((c) => c.key), ["address", "locations"]);
  assert.equal(m.hidden, false);
});

test("bio keeps its line breaks and is trimmed", () => {
  assert.equal(aboutModel({ bio: "  Line one\r\nLine two  " }).bio.text, "Line one\nLine two");
});

test("multiple positions are kept, duplicates (case or spacing) once", () => {
  assert.deepEqual(uniqueLabels(["Clerk", " clerk ", "Admin  Aide", "", null, "Admin Aide"]), ["Clerk", "Admin Aide"]);
  assert.equal(aboutModel({ positions: ["A", "B", "C"], isOwner: false }).positions.length, 3);
});

test("owner: every empty part shows an Add prompt", () => {
  const m = aboutModel({ isOwner: true });
  assert.equal(m.bio.state, "add");
  assert.deepEqual(m.rowB.map((c) => c.state), ["add", "add"]);
  assert.deepEqual(m.rowC.map((c) => c.state), ["add", "add"]);
  assert.equal(m.hidden, false);
});

test("other viewers: an empty part shows nothing", () => {
  const m = aboutModel({ bio: "Hello", isOwner: false });
  assert.equal(m.bio.state, "filled");
  assert.deepEqual(m.rowB, []);
  assert.deepEqual(m.rowC, []);
});

test("one column empty: the other remains alone so it can span the row", () => {
  const m = aboutModel({ positions: ["Clerk"], isOwner: false });
  assert.deepEqual(m.rowB, [{ key: "positions", state: "filled" }]);
  const owner = aboutModel({ positions: ["Clerk"], isOwner: true });
  assert.deepEqual(owner.rowB.map((c) => c.state), ["filled", "add"]);
});

test("every block empty: hidden for other viewers, never for the owner", () => {
  assert.equal(aboutModel({ isOwner: false }).hidden, true);
  assert.equal(aboutModel({ bio: "   ", positions: [""], isOwner: false }).hidden, true);
  assert.equal(aboutModel({ isOwner: true }).hidden, false);
});

test("profileAbout strings exist in en and fil with the same keys and no empty values", () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), "utf8"));
  const en = read("en").profileAbout;
  const fil = read("fil").profileAbout;
  assert.ok(en && fil, "profileAbout missing in en or fil");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fil).sort());
  for (const key of Object.keys(fil)) assert.ok(String(fil[key]).trim(), `fil.profileAbout.${key} empty`);
});
