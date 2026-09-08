// Shared constants + helpers for job qualifications / requirements.
// Used by QualificationsEditor (authoring) and QualificationsDisplay (viewing)
// so the two never drift apart on labels, icons, or grouping rules.
//
// UI/UX decision (Skill Types Patch): "skill" and the legacy catch-all "other"
// are presented as ONE bucket. Existing jobs may still carry `type: "other"`
// in the database, so we fold it to "skill" on the way in rather than migrate.

import { QUALIFICATION_TEMPLATES } from "../data/qualificationsTemplates";

// Non-skill requirement types, in display order. "skill" is handled separately
// as its own merged bucket and is intentionally not in this list.
export const REQUIREMENT_TYPES = [
  { value: "education", label: "Education" },
  { value: "experience", label: "Experience" },
  { value: "certification", label: "Certification" },
  { value: "license", label: "License" },
];

export const TYPE_LABELS = {
  education: "Education",
  experience: "Experience",
  skill: "Skills & Competencies",
  certification: "Certifications",
  license: "Licenses",
  other: "Skills & Competencies",
};

export const TYPE_ICONS = {
  education: "🎓",
  experience: "💼",
  skill: "🧩",
  certification: "📜",
  license: "📄",
  other: "🧩",
};

// Order used when grouping a list for display.
export const TYPE_ORDER = ["education", "experience", "certification", "license", "skill"];

// Collapse the legacy "other" type into "skill".
export const foldType = (type) => {
  const t = String(type || "").trim().toLowerCase();
  if (t === "other") return "skill";
  if (["education", "experience", "skill", "certification", "license"].includes(t)) return t;
  return "skill";
};

export const isSkillType = (type) => foldType(type) === "skill";

// Normalize a single raw qualification (from the API, a template, or the editor)
// into the canonical shape { type, value, optional, order }.
export const normalizeQualification = (raw, index = 0) => ({
  type: foldType(raw?.type),
  value: String(raw?.value ?? raw?.text ?? "").trim(),
  optional: Boolean(raw?.optional ?? raw?.isPreferred),
  order: Number.isFinite(raw?.order) ? raw.order : index,
});

export const normalizeQualifications = (list = []) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((item, index) => normalizeQualification(item, index))
    .filter((item) => item.value)
    .map((item, index) => ({ ...item, order: index }));
};

// Group a normalized list by folded type, returned in TYPE_ORDER.
export const groupQualificationsByType = (list = []) => {
  const groups = {};
  normalizeQualifications(list).forEach((item) => {
    (groups[item.type] = groups[item.type] || []).push(item);
  });
  return TYPE_ORDER.filter((type) => groups[type]?.length).map((type) => ({
    type,
    items: groups[type],
  }));
};

// The 10 built-in templates from data/qualificationsTemplates.js, shaped like
// the objects the API returns for server templates:
//   { id, name, jobTitle, source: "static", items: [...] }
// These are a fallback for when the API is unreachable; the server also serves
// its own "system" copies, so callers should prefer the fetched list and use
// these only when that fetch fails.
export const STATIC_TEMPLATES = Object.entries(QUALIFICATION_TEMPLATES).map(
  ([key, items]) => ({
    id: `static:${key}`,
    name: key.replace(/_/g, " "),
    jobTitle: key.replace(/_/g, " "),
    source: "static",
    items: normalizeQualifications(items),
  })
);

// Pick the template whose jobTitle best matches what the employer typed.
// Returns the template object or null. Exact-ish match only — we don't want to
// surprise the employer with a loose guess.
export const suggestTemplateForTitle = (templates, jobTitle) => {
  const title = String(jobTitle || "").trim().toLowerCase();
  if (title.length < 3 || !Array.isArray(templates)) return null;
  const candidates = templates.filter((tpl) => {
    const hint = String(tpl.jobTitle || tpl.name || "").trim().toLowerCase();
    if (!hint) return false;
    return title === hint || title.includes(hint) || hint.includes(title);
  });
  // Prefer the closest length match so "nurse" beats "nursing assistant".
  candidates.sort((a, b) => {
    const ha = String(a.jobTitle || a.name || "").toLowerCase();
    const hb = String(b.jobTitle || b.name || "").toLowerCase();
    return Math.abs(ha.length - title.length) - Math.abs(hb.length - title.length);
  });
  return candidates[0] || null;
};
