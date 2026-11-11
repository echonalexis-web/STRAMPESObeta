import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FaCheck,
  FaExclamationTriangle,
  FaListUl,
  FaMagic,
  FaPlus,
  FaRegSave,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import "../styles/qualifications-editor.css";
import { MODAL_TAG_GROUPS } from "../data/jobRequirements";
import {
  MAX_SKILL_QUALIFICATIONS,
  STATIC_TEMPLATES,
  countSkillQualifications,
  foldType,
  isSkillType,
  normalizeQualifications,
  suggestTemplateForTitle,
} from "../utils/qualifications";
import {
  STEP_IDS,
  canChooseRequired,
  countsByStep,
  groupActiveItems,
  isStepReachable,
  newItemShape,
  requiredDocumentCount,
  stepStatus,
  withPersonalSkillsPreferred,
} from "../utils/qualificationSteps";

// Which palette groups each step shows. Personal skills shows Soft Skills and
// Trades & Service together, with the two as an in-step filter ("All" by default).
const STEP_GROUPS = { skills: ["soft", "trades"], tesda: ["tesda"], clearances: ["clearances"] };
const groupsOfStep = (stepId) => MODAL_TAG_GROUPS.filter((g) => STEP_GROUPS[stepId].includes(g.id));
const PALETTE_PAGE_SIZE = 12;
const STEP_GROUP_FOR_ITEM = { tesda: "tesda", clearances: "clearance" };

// How many Required items before the strictness meter warns that the bar
// may be too high for most candidates to clear.
const STRICTNESS_WARN_AT = 6;
const STRICTNESS_BALANCED_AT = 3;

const dedupeKey = (item) => `${foldType(item.type)}::${String(item.value).trim().toLowerCase()}`;

const sameItem = (item, value, type) =>
  foldType(item.type) === foldType(type) &&
  String(item.value).trim().toLowerCase() === String(value).trim().toLowerCase();

const strictnessTier = (requiredCount) => {
  if (requiredCount >= STRICTNESS_WARN_AT) return "Narrow";
  if (requiredCount >= STRICTNESS_BALANCED_AT) return "Balanced";
  return "Broad";
};

export default function QualificationsEditor({
  value,
  qualifications, // legacy prop name — tolerated so old callers still seed correctly
  onChange,
  disabled = false,
  label = "Qualifications",
  required = false,
  showTemplates = true,
  templates = null,
  jobTitleHint = "",
  onSaveTemplate = null,
}) {
  const incomingValue = Array.isArray(value)
    ? value
    : Array.isArray(qualifications)
    ? qualifications
    : [];
  // A personal skill is always Preferred: an old posting, draft or template opens with its
  // skills shown as Preferred and saves them that way on the next change.
  const safeValue = useMemo(() => withPersonalSkillsPreferred(normalizeQualifications(incomingValue)), [incomingValue]);

  const resolvedTemplates = useMemo(() => {
    if (Array.isArray(templates) && templates.length) return templates;
    return STATIC_TEMPLATES;
  }, [templates]);

  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [skipped, setSkipped] = useState({});
  const [finished, setFinished] = useState(false);
  const [filter, setFilter] = useState("all");
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef(null);
  const movedByUser = useRef(false);
  const [showAllByTab, setShowAllByTab] = useState({});
  const stepId = STEP_IDS[step];
  const stepCounts = countsByStep(safeValue);
  const showRequiredToggle = canChooseRequired(stepId);
  const [search, setSearch] = useState("");
  const [newItemOptional, setNewItemOptional] = useState(false);
  const [capNotice, setCapNotice] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveError, setSaveError] = useState("");

  const suggestion = useMemo(() => {
    if (safeValue.length > 0) return null;
    return suggestTemplateForTitle(resolvedTemplates, jobTitleHint);
  }, [safeValue.length, resolvedTemplates, jobTitleHint]);

  const skillCount = countSkillQualifications(safeValue);
  const skillCapReached = skillCount >= MAX_SKILL_QUALIFICATIONS;

  // After a step change the user asked for: tell screen readers and move focus to the heading.
  useEffect(() => {
    if (!movedByUser.current) return;
    movedByUser.current = false;
    setAnnounce(t("qualSteps.announce", { current: step + 1, total: STEP_IDS.length, name: t(`qualSteps.steps.${STEP_IDS[step]}`) }));
    headingRef.current?.focus();
  }, [step, t]);

  useEffect(() => {
    if (!capNotice) return undefined;
    const timer = setTimeout(() => setCapNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [capNotice]);

  const hasItem = (itemValue, itemType) => safeValue.some((item) => sameItem(item, itemValue, itemType));

  // Single entry point for adding one or more items at once (a palette tap,
  // an Enter-add, or a whole role/template's worth) — applies instantly, no
  // separate "apply" step, and enforces the skill cap along the way instead
  // of letting a bulk add silently blow past it.
  const addItems = (incoming) => {
    const seen = new Set(safeValue.map(dedupeKey));
    let runningSkillCount = skillCount;
    let skippedForCap = false;
    const toAdd = [];

    incoming.forEach((raw) => {
      const item = {
        type: foldType(raw.type),
        value: String(raw.value || "").trim(),
        optional: isSkillType(raw.type) ? true : Boolean(raw.optional),
        ...(raw.group ? { group: raw.group } : {}),
      };
      if (!item.value) return;
      const key = dedupeKey(item);
      if (seen.has(key)) return;
      if (isSkillType(item.type)) {
        if (runningSkillCount >= MAX_SKILL_QUALIFICATIONS) {
          skippedForCap = true;
          return;
        }
        runningSkillCount += 1;
      }
      seen.add(key);
      toAdd.push(item);
    });

    if (skippedForCap) {
      setCapNotice(`Skill limit reached — you can add up to ${MAX_SKILL_QUALIFICATIONS} skills.`);
    }
    if (!toAdd.length) return;

    const next = [...safeValue, ...toAdd].map((item, index) => ({ ...item, order: index }));
    onChange(next);
  };

  const removeItem = (index) => {
    onChange(safeValue.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i })));
  };

  const toggleRequired = (index) => {
    // Personal skills have no Required control; only documents can change level.
    onChange(safeValue.map((item, i) => (i === index && !isSkillType(item.type) ? { ...item, optional: !item.optional } : item)));
  };

  const togglePaletteItem = (itemValue, itemType) => {
    if (hasItem(itemValue, itemType)) {
      onChange(
        safeValue
          .filter((item) => !sameItem(item, itemValue, itemType))
          .map((item, index) => ({ ...item, order: index }))
      );
      return;
    }
    const group = STEP_GROUP_FOR_ITEM[stepId];
    addItems([{ type: itemType, value: itemValue, optional: showRequiredToggle ? newItemOptional : true, ...(group ? { group } : {}) }]);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    addItems(normalizeQualifications(suggestion.items));
  };

  const loadRole = (template) => {
    addItems(normalizeQualifications(template.items));
  };

  // The search is scoped to the current step: a match comes from this step's items, and a
  // typed custom item gets this step's category.
  const stepItems = groupsOfStep(stepId).flatMap((g) => g.items);
  const handleSearchEnter = () => {
    const query = search.trim();
    if (!query) return;
    const q = query.toLowerCase();
    const group = STEP_GROUP_FOR_ITEM[stepId];
    const optional = showRequiredToggle ? newItemOptional : true;
    const found = stepItems.find((item) => item.value.toLowerCase() === q) || stepItems.find((item) => item.value.toLowerCase().includes(q));
    if (found) {
      addItems([{ type: found.type, value: found.value, optional, ...(group ? { group } : {}) }]);
    } else {
      addItems([{ ...newItemShape(stepId), value: query, optional }]);
    }
    setSearch("");
  };

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) return;
    const name = templateName.trim();
    if (!name) {
      setSaveError("Give the template a name");
      return;
    }
    if (!safeValue.length) {
      setSaveError("Add at least one requirement first");
      return;
    }
    setSavingTemplate(true);
    setSaveError("");
    try {
      await onSaveTemplate({ name, items: safeValue });
      setShowTemplateSave(false);
      setTemplateName("");
    } catch (err) {
      setSaveError(err?.response?.data?.message || "Could not save template");
    } finally {
      setSavingTemplate(false);
    }
  };

  // ---- Palette: this step's items (and the in-step filter), searched, capped at 12 ----
  const stepGroups = groupsOfStep(stepId);
  const filterGroups = stepId === "skills" && filter !== "all" ? stepGroups.filter((g) => g.id === filter) : stepGroups;
  const paletteItems = filterGroups.flatMap((g) => g.items);
  const q = search.trim().toLowerCase();
  const matchingGroupItems = q ? paletteItems.filter((item) => item.value.toLowerCase().includes(q)) : paletteItems;
  const showAllKey = `${stepId}:${filter}`;
  const showAll = Boolean(showAllByTab[showAllKey]);
  const visibleItems = showAll ? matchingGroupItems : matchingGroupItems.slice(0, PALETTE_PAGE_SIZE);
  const hiddenCount = matchingGroupItems.length - visibleItems.length;

  // The Broad / Balanced / Narrow label counts required documents (personal skills are never required).
  const requiredCount = requiredDocumentCount(safeValue);
  const strictness = strictnessTier(requiredCount);
  const activeGroups = groupActiveItems(safeValue);

  const goTo = (next) => {
    movedByUser.current = true;
    setFinished(false);
    setFilter("all");
    setSearch("");
    setStep(next);
    setMaxReached((m) => Math.max(m, next));
  };
  const skipStep = () => {
    setSkipped((prev) => ({ ...prev, [stepId]: true }));
    goTo(Math.min(step + 1, STEP_IDS.length - 1));
  };
  const finish = () => {
    setFinished(true);
    setAnnounce(t("qualSteps.doneAnnounce"));
  };

  return (
    <div className="qe">
      {label && (
        <div className="qe-label">
          {label}
          {required && <span className="qe-req-star"> *</span>}
        </div>
      )}

      {suggestion && (
        <button type="button" className="qe-suggestion" onClick={applySuggestion} disabled={disabled}>
          <FaMagic /> Use the <strong>{suggestion.name}</strong> template for &ldquo;{jobTitleHint}&rdquo;?
        </button>
      )}

      {showTemplates && resolvedTemplates.length > 0 && (
        <div className="qe-roles">
          <span className="qe-roles-label">Start from a role</span>
          <div className="qe-roles-chips">
            {resolvedTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="qe-role-chip"
                onClick={() => loadRole(tpl)}
                disabled={disabled}
                title={`Add ${tpl.name}'s typical requirements`}
              >
                <FaPlus /> {tpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- In-step stepper: Personal skills, TESDA & Certifications, Government clearances ---- */}
      <nav className="qe-stepper" aria-label={t("qualSteps.stepperLabel")}>
        <ol className="qe-stepper-list">
          {STEP_IDS.map((id, index) => {
            const count = stepCounts[id];
            const status = stepStatus(count, skipped[id]);
            const reachable = isStepReachable(index, maxReached, safeValue.length > 0);
            return (
              <li key={id} className="qe-stepper-item">
                <button
                  type="button"
                  className={`qe-step ${index === step ? "is-current" : ""} ${count > 0 ? "is-filled" : ""}`}
                  aria-current={index === step ? "step" : undefined}
                  disabled={disabled || !reachable}
                  onClick={() => goTo(index)}
                >
                  <span className="qe-step-num" aria-hidden="true">{count > 0 ? <FaCheck /> : index + 1}</span>
                  <span className="qe-step-text">
                    <span className="qe-step-name">{t(`qualSteps.steps.${id}`)}</span>
                    <span className="qe-step-status">
                      {status === "count" ? t("qualSteps.countAdded", { count }) : status === "skipped" ? t("qualSteps.noneNeeded") : t("qualSteps.noneAdded")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="ds-sr-only" role="status" aria-live="polite">{announce}</p>

      <section className="qe-step-panel" aria-labelledby="qe-step-heading">
        <h3 id="qe-step-heading" className="qe-step-heading" tabIndex={-1} ref={headingRef}>
          {t(`qualSteps.steps.${stepId}`)}
        </h3>
        <p className="qe-step-explain">{t(`qualSteps.explain.${stepId}`)}</p>

        <div className="qe-search-head">
          <span className="qe-search-head-label">Find or add a qualification</span>
          {showRequiredToggle ? (
            <span className="qe-search-head-toggle">
              <span className="qe-search-head-toggle-text">New items are added as</span>
              <span className="qe-seg" role="group" aria-label="New items are added as">
                <button
                  type="button"
                  className={`qe-seg-btn ${!newItemOptional ? "is-active" : ""}`}
                  onClick={() => setNewItemOptional(false)}
                  disabled={disabled}
                >
                  Required
                </button>
                <button
                  type="button"
                  className={`qe-seg-btn ${newItemOptional ? "is-active" : ""}`}
                  onClick={() => setNewItemOptional(true)}
                  disabled={disabled}
                >
                  Preferred
                </button>
              </span>
            </span>
          ) : (
            <span className="qe-personal-note">{t("qualSteps.personalNote")}</span>
          )}
        </div>
        <div className="qe-search">
          <FaSearch />
          <input
            type="text"
            aria-label="Find or add a qualification"
            value={search}
            placeholder="Type a skill, licence or clearance. Press Enter to add."
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearchEnter();
              }
            }}
            disabled={disabled}
          />
        </div>

        {capNotice && (
          <div className="qe-cap-notice">
            <FaExclamationTriangle /> {capNotice}
          </div>
        )}

        {stepId === "skills" && (
          <div className="qe-tabs" role="group" aria-label={t("qualSteps.filterLabel")}>
            {[{ id: "all", label: t("qualSteps.filterAll") }, ...stepGroups.map((g) => ({ id: g.id, label: g.label }))].map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={filter === tab.id}
                className={`qe-tab ${filter === tab.id ? "is-active" : ""}`}
                onClick={() => setFilter(tab.id)}
                disabled={disabled}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="qe-palette-group">
          {visibleItems.length === 0 ? (
            <p className="qe-palette-empty">
              {q ? "Nothing matches that in this category. Press Enter to add it as a custom item." : "No items in this category."}
            </p>
          ) : (
            <div className="qe-palette">
              {visibleItems.map((item) => {
                const active = hasItem(item.value, item.type);
                const capBlocked = !active && isSkillType(item.type) && skillCapReached;
                return (
                  <button
                    key={`${item.type}-${item.value}`}
                    type="button"
                    className={`qe-palette-pill ${active ? "is-active" : ""} ${capBlocked ? "is-cap-blocked" : ""}`}
                    onClick={() => togglePaletteItem(item.value, item.type)}
                    disabled={disabled || capBlocked}
                    aria-pressed={active}
                    title={capBlocked ? `Skill limit reached (${MAX_SKILL_QUALIFICATIONS}/${MAX_SKILL_QUALIFICATIONS})` : undefined}
                  >
                    {active ? <FaCheck /> : <FaPlus />}
                    {item.value}
                  </button>
                );
              })}
            </div>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="qe-show-all-btn" onClick={() => setShowAllByTab((prev) => ({ ...prev, [showAllKey]: true }))}>
              Show all {matchingGroupItems.length}
            </button>
          )}
        </div>

        <div className="qe-step-nav">
          <button type="button" className="qe-ghost-btn" onClick={() => goTo(step - 1)} disabled={disabled || step === 0}>
            {t("qualSteps.back")}
          </button>
          <span className="qe-step-nav-right">
            {showRequiredToggle && (
              <button type="button" className="qe-ghost-btn" onClick={skipStep} disabled={disabled}>
                {t("qualSteps.noneNeeded")}
              </button>
            )}
            {step < STEP_IDS.length - 1 ? (
              <button type="button" className="qe-primary-btn" onClick={() => goTo(step + 1)} disabled={disabled}>
                {t("qualSteps.next")}
              </button>
            ) : (
              <button type="button" className="qe-primary-btn" onClick={finish} disabled={disabled}>
                {t("qualSteps.done")}
              </button>
            )}
          </span>
        </div>
        {finished && <p className="qe-step-done">{t("qualSteps.doneNote")}</p>}
      </section>

      {/* ---- Active qualifications, grouped Required / Preferred ---- */}
      <div className="qe-active">
        <div className="qe-active-head">
          <div className="qe-active-title">
            <FaListUl />
            <span>Active qualifications</span>
            <span className="qe-count">{safeValue.length}</span>
          </div>
          <span className={`qe-strictness qe-strictness--${strictness.toLowerCase()}`}>
            {strictness === "Narrow" && <FaExclamationTriangle />}
            {strictness} ({requiredCount} required)
          </span>
        </div>

        {strictness === "Narrow" && (
          <p className="qe-strictness-warning">
            {requiredCount} required items may filter out otherwise-qualified candidates. Consider
            marking some as Preferred instead.
          </p>
        )}

        {safeValue.length === 0 && (
          <p className="qe-active-empty">
            No qualifications yet. Search above, pick from a category, or start from a role.
          </p>
        )}

        {STEP_IDS.map((id) => {
          const entries = activeGroups[id];
          const headingId = `qe-group-${id}`;
          return (
            <section key={id} className="qe-active-section qe-active-group" aria-labelledby={headingId}>
              <h4 id={headingId} className="qe-active-section-label qe-active-group-title">
                {t(`qualSteps.steps.${id}`)}
                <span className="qe-count qe-count--small">{entries.length}</span>
              </h4>
              {entries.length === 0 ? (
                <p className="qe-active-group-empty">{t("qualSteps.noneAdded")}</p>
              ) : (
                <div className="qe-active-grid">
                  {entries.map(({ item, index }) => {
                    const preferred = Boolean(item.optional);
                    const fixedPreferred = isSkillType(item.type);
                    return (
                      <span key={`${item.type}-${item.value}-${index}`} className={`qe-tag ${preferred ? "is-preferred" : ""}`}>
                        <span className="qe-tag-value">{item.value}</span>
                        {fixedPreferred ? (
                          <span className="qe-tag-switch is-preferred is-fixed">Preferred</span>
                        ) : (
                          <button
                            type="button"
                            className={`qe-tag-switch ${preferred ? "is-preferred" : ""}`}
                            onClick={() => toggleRequired(index)}
                            disabled={disabled}
                            title={preferred ? "Switch to Required" : "Switch to Preferred"}
                          >
                            {preferred ? "Preferred" : "Required"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="qe-tag-remove"
                          onClick={() => removeItem(index)}
                          disabled={disabled}
                          aria-label={`Remove ${item.value}`}
                        >
                          <FaTimes />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {onSaveTemplate && (
          <div className="qe-save-template">
            {showTemplateSave ? (
              <div className="qe-save-template-form">
                <input
                  type="text"
                  value={templateName}
                  placeholder="Template name (e.g. Kitchen Staff)"
                  onChange={(event) => setTemplateName(event.target.value)}
                  disabled={savingTemplate}
                />
                <button
                  type="button"
                  className="qe-ghost-btn"
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate || !templateName.trim()}
                >
                  {savingTemplate ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="qe-ghost-btn"
                  onClick={() => {
                    setShowTemplateSave(false);
                    setSaveError("");
                  }}
                  disabled={savingTemplate}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="qe-link-btn"
                onClick={() => {
                  setShowTemplateSave(true);
                  setTemplateName("");
                  setSaveError("");
                }}
                disabled={safeValue.length === 0}
              >
                <FaRegSave /> Save these as a reusable template
              </button>
            )}
            {saveError && <div className="qe-save-template-error">{saveError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
