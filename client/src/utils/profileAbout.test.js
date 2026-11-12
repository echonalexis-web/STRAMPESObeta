import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aboutModel, splitPlace, titleCasePlace, uniqueLabels } from "./profileAbout.js";

const full = {
  bio: "Hi!\nI am Alexis.",
  positions: ["Administrative Aide", "Clerk"],
  status: "Actively Looking",
  address: "TANZA, BOAC, MARINDUQUE",
  locations: ["Boac", "Japan"],
};

test("blocks come in order: bio, positions and status, address, then locations on their own row", () => {
  const m = aboutModel({ ...full, isOwner: true });
  assert.equal(m.bio.state, "filled");
  assert.deepEqual(m.rowB.map((c) => c.key), ["positions", "status"]);
  assert.deepEqual(m.rowC.map((c) => c.key), ["address"]);
  assert.deepEqual(m.rowD.map((c) => c.key), ["locations"]);
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
  assert.deepEqual(m.rowC.map((c) => c.state), ["add"]);
  assert.deepEqual(m.rowD.map((c) => c.state), ["add"]);
  assert.equal(m.hidden, false);
});

test("other viewers: an empty part shows nothing", () => {
  const m = aboutModel({ bio: "Hello", isOwner: false });
  assert.equal(m.bio.state, "filled");
  assert.deepEqual(m.rowB, []);
  assert.deepEqual(m.rowC, []);
  assert.deepEqual(m.rowD, []);
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

test("locations: local and overseas stay separate, duplicates once, plain list reads as local", () => {
  const m = aboutModel({ localLocations: ["BOAC, MARINDUQUE", " boac, marinduque "], overseasLocations: ["Singapore", "United States"], locations: ["Makati"], isOwner: false });
  assert.deepEqual(m.localLocations, ["BOAC, MARINDUQUE", "Makati"]);
  assert.deepEqual(m.overseasLocations, ["Singapore", "United States"]);
  assert.equal(m.locations.length, 4);
  assert.deepEqual(m.rowD, [{ key: "locations", state: "filled" }]);
  assert.deepEqual(aboutModel({ overseasLocations: ["Japan"], isOwner: false }).rowD.length, 1);
});

test("a place in capitals is shown in Title Case, split into place and region", () => {
  assert.deepEqual(splitPlace("CITY OF MAKATI, NATIONAL CAPITAL REGION - FOURTH DISTRICT"), {
    title: "City of Makati",
    sub: "National Capital Region - Fourth District",
  });
  assert.deepEqual(splitPlace("BOAC, MARINDUQUE"), { title: "Boac", sub: "Marinduque" });
  assert.deepEqual(splitPlace("QUEZON CITY, NATIONAL CAPITAL REGION - SECOND DISTRICT"), {
    title: "Quezon City",
    sub: "National Capital Region - Second District",
  });
});

test("Title Case keeps Roman numerals and known acronyms, and leaves mixed-case names alone", () => {
  assert.equal(titleCasePlace("TANZA, BOAC, REGION IV-B"), "Tanza, Boac, Region IV-B");
  assert.equal(titleCasePlace("NCR"), "NCR");
  assert.equal(titleCasePlace("Singapore"), "Singapore");
  assert.equal(titleCasePlace("United States"), "United States");
  assert.equal(titleCasePlace(""), "");
  assert.deepEqual(splitPlace("Singapore"), { title: "Singapore", sub: "" });
});
