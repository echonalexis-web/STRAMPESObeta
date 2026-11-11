import test from "node:test";
import assert from "node:assert/strict";
import {
  canChooseRequired,
  countsByStep,
  groupActiveItems,
  isStepReachable,
  newItemShape,
  requiredDocumentCount,
  selectAllState,
  stepOfItem,
  stepStatus,
  withPersonalSkillsPreferred,
} from "./qualificationSteps.js";

test("a category maps to its step", () => {
  assert.equal(stepOfItem({ type: "skill", value: "Teamwork" }), "skills");
  assert.equal(stepOfItem({ type: "other", value: "x" }), "skills");
  assert.equal(stepOfItem({ type: "certification", value: "TESDA National Certificate (NC II)" }), "tesda");
  assert.equal(stepOfItem({ type: "license", value: "PRC Professional License" }), "tesda");
  assert.equal(stepOfItem({ type: "certification", value: "NBI Clearance" }), "clearances");
  assert.equal(stepOfItem({ type: "certification", value: "My custom clearance", group: "clearance" }), "clearances");
  assert.equal(stepOfItem({ type: "certification", value: "NBI Clearance", group: "tesda" }), "tesda");
});

test("the Required toggle shows only on the two document steps", () => {
  assert.equal(canChooseRequired("skills"), false);
  assert.equal(canChooseRequired("tesda"), true);
  assert.equal(canChooseRequired("clearances"), true);
});

test("a typed custom item gets its step's category", () => {
  assert.deepEqual(newItemShape("skills"), { type: "skill" });
  assert.deepEqual(newItemShape("tesda"), { type: "certification", group: "tesda" });
  assert.deepEqual(newItemShape("clearances"), { type: "certification", group: "clearance" });
});

test("personal skills are always preferred; documents are untouched", () => {
  const out = withPersonalSkillsPreferred([
    { type: "skill", value: "a", optional: false },
    { type: "other", value: "b", optional: false },
    { type: "certification", value: "c", optional: false },
  ]);
  assert.deepEqual(out.map((i) => i.optional), [true, true, false]);
  assert.deepEqual(withPersonalSkillsPreferred(null), []);
});

test("grouping keeps indexes, never mixes groups, lists Required before Preferred", () => {
  const list = [
    { type: "skill", value: "a", optional: true },
    { type: "certification", value: "NBI Clearance", optional: true },
    { type: "certification", value: "TESDA NC II", optional: true },
    { type: "certification", value: "Police Clearance", optional: false },
    { type: "license", value: "PRC", optional: false },
  ];
  const g = groupActiveItems(list);
  assert.deepEqual(g.skills.map((e) => e.index), [0]);
  assert.deepEqual(g.tesda.map((e) => e.index), [4, 2]);
  assert.deepEqual(g.clearances.map((e) => e.index), [3, 1]);
  assert.deepEqual(countsByStep(list), { skills: 1, tesda: 2, clearances: 2 });
  assert.deepEqual(countsByStep([]), { skills: 0, tesda: 0, clearances: 0 });
});

test("Broad label counts required documents only", () => {
  assert.equal(
    requiredDocumentCount([
      { type: "skill", optional: false },
      { type: "certification", optional: false },
      { type: "license", optional: true },
    ]),
    1
  );
});

test("step status and reachability", () => {
  assert.equal(stepStatus(2, false), "count");
  assert.equal(stepStatus(0, false), "none");
  assert.equal(stepStatus(0, true), "skipped");
  assert.equal(isStepReachable(1, 0, false), false);
  assert.equal(isStepReachable(1, 1, false), true);
  assert.equal(isStepReachable(2, 0, true), true);
});

test("select-all checkbox state", () => {
  const modes = ["read", "write", "speak", "understand"];
  assert.equal(selectAllState(modes, null), "none");
  assert.equal(selectAllState(modes, { read: false, write: false, speak: false, understand: false }), "none");
  assert.equal(selectAllState(modes, { read: true, write: false, speak: false, understand: false }), "some");
  assert.equal(selectAllState(modes, { read: true, write: true, speak: true, understand: true }), "all");
});
