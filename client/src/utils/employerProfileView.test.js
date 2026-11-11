import test from "node:test";
import assert from "node:assert/strict";
import { addressLines, jobseekerSections, locationLine, postingsViewState, representativeRows } from "./employerProfileView.js";

test("address lines skip empty parts and join the place", () => {
  assert.deepEqual(addressLines({ street: "1 Ayala", barangay: "Poblacion", municipality: "Boac", province: "Marinduque" }), ["1 Ayala", "Poblacion", "Boac, Marinduque"]);
  assert.deepEqual(addressLines({ municipality: "Boac", province: "" }), ["Boac"]);
  assert.deepEqual(addressLines({ street: " ", barangay: "" }), []);
  assert.deepEqual(addressLines(null), []);
});

test("the header location is municipality and province only", () => {
  assert.equal(locationLine({ street: "1 Ayala", municipality: "Boac", province: "Marinduque" }), "Boac, Marinduque");
  assert.equal(locationLine(undefined), "");
});

test("representatives: name and position, empty lines hidden", () => {
  assert.deepEqual(representativeRows({ owner: { name: "Maria Santos" }, authorizedPerson: { name: "Juan", position: "Rep" } }), [
    { key: "owner", name: "Maria Santos", position: "" },
    { key: "authorizedPerson", name: "Juan", position: "Rep" },
  ]);
  assert.deepEqual(representativeRows({ authorizedPerson: { name: "Juan" } }), [{ key: "authorizedPerson", name: "Juan", position: "" }]);
  assert.deepEqual(representativeRows({ owner: { name: " " } }), []);
  assert.deepEqual(representativeRows({}), []);
});

test("which sections show for which data", () => {
  assert.deepEqual(jobseekerSections({ user: {}, profile: {} }), { about: false, address: false, representatives: false, postings: true });
  assert.deepEqual(
    jobseekerSections({ user: { companyDescription: "We serve joy." }, profile: { businessAddress: { municipality: "Boac" }, owner: { name: "M" } } }),
    { about: true, address: true, representatives: true, postings: true }
  );
  assert.equal(jobseekerSections(null).postings, true);
});

test("postings state: no empty flash while the first page loads", () => {
  assert.equal(postingsViewState({ status: "loading", items: [], loadedOnce: false }), "loading");
  assert.equal(postingsViewState({ status: "loading", items: [{}], loadedOnce: true }), "list");
  assert.equal(postingsViewState({ status: "ready", items: [], loadedOnce: true }), "empty");
  assert.equal(postingsViewState({ status: "ready", items: [{}], loadedOnce: true }), "list");
  assert.equal(postingsViewState({ status: "error", items: [], loadedOnce: false }), "error");
});
