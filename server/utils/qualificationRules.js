// Rules for the qualification items on a job posting or a saved template.
//
//  - A personal skill (type "skill", the legacy "other", or no type) is ALWAYS
//    preferred: `optional` is forced to true on save. Only documents (TESDA
//    certifications, licences, government clearances) can be required.
//  - Documents may carry a `group` ("tesda" or "clearance") so the form can show
//    a custom government clearance in its own step. Any other value is dropped.
//
// Only the SAVE paths use this. Stored postings are never rewritten and the
// matcher still reads what is stored (see markdowns or the PR notes).

const DOCUMENT_GROUPS = ["tesda", "clearance"];

const isPersonalSkillType = (type) => {
  const t = String(type || "").trim().toLowerCase();
  return t === "skill" || t === "other" || !t;
};

const isDocumentType = (type) => {
  const t = String(type || "").trim().toLowerCase();
  return t === "certification" || t === "license";
};

const normalizeQualificationItem = (item) => {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  if (isPersonalSkillType(out.type)) out.optional = true;
  if (isDocumentType(out.type) && DOCUMENT_GROUPS.includes(out.group)) {
    // keep
  } else {
    delete out.group;
  }
  return out;
};

const normalizeQualificationList = (list) => (Array.isArray(list) ? list.map(normalizeQualificationItem) : list);

module.exports = { DOCUMENT_GROUPS, isPersonalSkillType, isDocumentType, normalizeQualificationItem, normalizeQualificationList };
