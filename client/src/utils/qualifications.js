// Shared constants + helpers for job qualifications / requirements.
// Used by QualificationsEditor (authoring) and QualificationsDisplay (viewing)
// so the two never drift apart on labels, icons, or grouping rules.
//
// UI/UX decision (Skill Types Patch): "skill" and the legacy catch-all "other"
// are presented as ONE bucket. Existing jobs may still carry `type: "other"`
// in the database, so we fold it to "skill" on the way in rather than migrate.

import { QUALIFICATION_TEMPLATES } from "../data/qualificationsTemplates";

// Mirrored server-side in controllers/employerController.js
// (MAX_SKILL_QUALIFICATIONS) so the cap can't be bypassed by calling the API
// directly — keep both in sync if this ever changes.
export const MAX_SKILL_QUALIFICATIONS = 8;

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

export const countSkillQualifications = (list = []) =>
  (Array.isArray(list) ? list : []).filter((item) => isSkillType(item?.type)).length;

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

// ============================================================
// Match-score tier vocabulary — shared by every surface that shows a match
// percentage (the literal checklist percent, OR the fuzzy relevanceScore
// estimate used when no checklist exists). Mirrors the server's
// checklistTier() in server/services/semanticService.js — keep both in sync
// if either changes.
//
// Before this was centralized, each surface duplicated its own thresholds
// and label text and drifted apart: the same 60% match read "Good" on a job
// card, "High" on the employer table, and a third, CSS-inferred label on the
// job card's no-checklist fallback. Every surface now derives its label from
// this single table instead of re-deriving one locally.
// ============================================================
export const MATCH_TIER_THRESHOLDS = [
  { min: 85, tier: "Strong" },
  { min: 60, tier: "Good" },
  { min: 35, tier: "Partial" },
  { min: 0, tier: "Low" },
];

// The 4-value tier vocabulary collapsed to the 3 CSS buckets the
// `vac-match-tier`/`job-match-panel` stylesheets define colors for — Good
// and Partial both read as the visual "middle" state.
export const MATCH_TIER_CLASS = { Strong: "high", Good: "mid", Partial: "mid", Low: "low" };

// Same collapse, but to the older `match-high`/`match-medium`/`match-low`
// CSS family (jobboard.css / dashboard.css / employer-dashboard.css) used by
// the employer-facing Modal and RankedApplicantsTable badges.
export const MATCH_TIER_LEGACY_CLASS = { Strong: "match-high", Good: "match-high", Partial: "match-medium", Low: "match-low" };

export const tierForPercent = (percent) => {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const match = MATCH_TIER_THRESHOLDS.find((t) => p >= t.min) || MATCH_TIER_THRESHOLDS[MATCH_TIER_THRESHOLDS.length - 1];
  return { tier: match.tier, cls: MATCH_TIER_CLASS[match.tier], percent: p };
};

// `score` is the 0..1 relevanceScore scale; converts to a percent first.
export const tierForScore = (score) => tierForPercent((Number(score) || 0) * 100);

export const legacyMatchClassForScore = (score) => MATCH_TIER_LEGACY_CLASS[tierForScore(score).tier];

// ============================================================
// matchBreakdown dimension vocabulary — shared by every surface that shows
// the per-dimension score breakdown (job detail's "Why this match?" panel,
// the employer applicant review modal, the ranked-applicants table tooltip).
// Mirrors server/services/semanticService.js's DEFAULT_DIMENSION_WEIGHTS
// keys exactly — keep both in sync if either changes.
// ============================================================
export const DIMENSION_ORDER = [
  "skills", "title", "experience", "education", "credentials",
  "industry", "language", "salary", "location", "employmentType",
];

export const DIMENSION_LABELS = {
  skills: "Skills",
  title: "Job title fit",
  experience: "Experience",
  education: "Education",
  credentials: "Certifications / licenses",
  industry: "Industry",
  language: "Language",
  salary: "Salary fit",
  location: "Location",
  employmentType: "Employment type",
};

// Mirrors server/services/semanticService.js's DEFAULT_DIMENSION_WEIGHTS,
// expressed as integer percentages (0-100, summing to 100) for the
// configurable-weights UI (§C.1) — the "code fallback" link in the
// resolution chain (per-vacancy → employer default → admin default → this).
export const CODE_FALLBACK_WEIGHTS = {
  skills: 27, title: 11, experience: 12, education: 9, credentials: 6,
  industry: 10, language: 4, salary: 6, location: 9, employmentType: 6,
};

// The revision document's five sample weights (Skills 35 · Education 20 ·
// Work Experience 20 · Location 15 · Certifications 10), offered as a named
// preset layered on top of the full ten-key set rather than replacing the
// schema (per §C.1's "ten-key default set" requirement). The other five
// dimensions read 0% under this preset — an honest reflection of the fact
// the revision document never assigned them a weight, not an omission.
export const PESO_RECOMMENDED_PRESET = {
  skills: 35, title: 0, experience: 20, education: 20, credentials: 10,
  industry: 0, language: 0, salary: 0, location: 15, employmentType: 0,
};

// Which /profile/edit tab (see EditProfile.jsx's `?tab=` deep-link support)
// a jobseeker would go to in order to supply the data this dimension needs.
// `null` means there's no profile UI for it yet — `employmentType` reads
// JobseekerProfile.preferredJobTypes/preferredWorkNature, which the profile
// editor doesn't currently expose any fields for, so linking there would
// land on a tab with nothing relevant to fill in.
export const DIMENSION_PROFILE_TAB = {
  skills: "profile",
  title: "career",
  experience: "career",
  education: "profile",
  credentials: "training",
  industry: "profile",
  language: "career",
  salary: "career",
  location: "career",
  employmentType: null,
};

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
