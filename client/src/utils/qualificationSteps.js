// Pure helpers for the step-by-step Qualifications picker and the grouped Active
// qualifications panel. Three steps, in order:
//   skills     Personal skills (Soft Skills and Trades & Service). Always Preferred.
//   tesda      TESDA & Certifications. Required or Preferred.
//   clearances Government clearances. Required or Preferred.
// The stored item keeps its old shape { type, value, optional, order }; a document
// may also carry group: "tesda" | "clearance" so a custom clearance stays in its step.

export const STEP_IDS = ["skills", "tesda", "clearances"];

// The built-in clearance values. An item with no stored group is placed by name, so
// postings saved before the steps existed still land in the right group.
const CLEARANCE_VALUES = ["barangay clearance", "nbi clearance", "police clearance"];

const typeOf = (item) => String(item?.type || "").trim().toLowerCase();
const isDocument = (item) => typeOf(item) === "certification" || typeOf(item) === "license";

export const stepOfItem = (item) => {
  if (!isDocument(item)) return "skills";
  if (item.group === "clearance") return "clearances";
  if (item.group === "tesda") return "tesda";
  return CLEARANCE_VALUES.includes(String(item?.value || "").trim().toLowerCase()) ? "clearances" : "tesda";
};

// Only documents can be Required.
export const canChooseRequired = (stepId) => stepId === "tesda" || stepId === "clearances";

// The type (and group) a new item gets in a step, so a typed custom entry lands in
// the step it was typed in.
export const newItemShape = (stepId) => {
  if (stepId === "tesda") return { type: "certification", group: "tesda" };
  if (stepId === "clearances") return { type: "certification", group: "clearance" };
  return { type: "skill" };
};

// A personal skill is always Preferred. Applied when a posting, draft or template is
// opened in the form and on every add, so it is saved as Preferred on the next save.
export const withPersonalSkillsPreferred = (list) =>
  (Array.isArray(list) ? list : []).map((item) => (typeOf(item) === "skill" || typeOf(item) === "other" ? { ...item, optional: true } : item));

// Active items per step. Each entry keeps its index in the full list, so remove and
// level changes act on the right item. Documents list Required before Preferred.
export const groupActiveItems = (list) => {
  const groups = { skills: [], tesda: [], clearances: [] };
  (Array.isArray(list) ? list : []).forEach((item, index) => groups[stepOfItem(item)].push({ item, index }));
  for (const id of ["tesda", "clearances"]) {
    groups[id] = [...groups[id].filter((e) => !e.item.optional), ...groups[id].filter((e) => e.item.optional)];
  }
  return groups;
};

export const countsByStep = (list) => {
  const groups = groupActiveItems(list);
  return { skills: groups.skills.length, tesda: groups.tesda.length, clearances: groups.clearances.length };
};

// Required documents only (personal skills are never required).
export const requiredDocumentCount = (list) =>
  (Array.isArray(list) ? list : []).filter((item) => isDocument(item) && !item.optional).length;

// The step label's status text key: a count, "none added", or "none needed" after a deliberate skip.
export const stepStatus = (count, skipped) => (count > 0 ? "count" : skipped ? "skipped" : "none");

// A step can be opened when it is the next one, one already reached, or any step once
// the form already holds items (edit, draft, template: do not walk through again).
export const isStepReachable = (index, maxReached, hasItems) => hasItems || index <= maxReached;

// The Select-all checkbox for a language's four proficiency pills.
export const selectAllState = (modes, entry) => {
  const on = (Array.isArray(modes) ? modes : []).filter((m) => entry && entry[m]).length;
  if (on === 0) return "none";
  return on === modes.length ? "all" : "some";
};
