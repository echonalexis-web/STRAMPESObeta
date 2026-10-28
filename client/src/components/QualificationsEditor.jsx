import { useEffect, useMemo, useState } from "react";
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

const TABS = MODAL_TAG_GROUPS.map((g) => ({ id: g.id, label: g.label }));
const ALL_TAG_ITEMS = MODAL_TAG_GROUPS.flatMap((g) => g.items);
const PALETTE_PAGE_SIZE = 12;

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
  const safeValue = useMemo(() => normalizeQualifications(incomingValue), [incomingValue]);

  const resolvedTemplates = useMemo(() => {
    if (Array.isArray(templates) && templates.length) return templates;
    return STATIC_TEMPLATES;
  }, [templates]);

  const [activeTab, setActiveTab] = useState(TABS[0]?.id || "soft");
  const [showAllByTab, setShowAllByTab] = useState({});
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
        optional: Boolean(raw.optional),
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
    onChange(safeValue.map((item, i) => (i === index ? { ...item, optional: !item.optional } : item)));
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
    addItems([{ type: itemType, value: itemValue, optional: newItemOptional }]);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    addItems(normalizeQualifications(suggestion.items));
  };

  const loadRole = (template) => {
    addItems(normalizeQualifications(template.items));
  };

  const handleSearchEnter = () => {
    const query = search.trim();
    if (!query) return;
    const q = query.toLowerCase();
    const exact = ALL_TAG_ITEMS.find((item) => item.value.toLowerCase() === q);
    const partial = exact || ALL_TAG_ITEMS.find((item) => item.value.toLowerCase().includes(q));
    if (partial) {
      addItems([{ type: partial.type, value: partial.value, optional: newItemOptional }]);
    } else {
      addItems([{ type: "skill", value: query, optional: newItemOptional }]);
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

  // ---- Palette: active tab's items, filtered by search, capped at 12 ----
  const activeGroup = MODAL_TAG_GROUPS.find((g) => g.id === activeTab) || MODAL_TAG_GROUPS[0];
  const q = search.trim().toLowerCase();
  const matchingGroupItems = q
    ? activeGroup.items.filter((item) => item.value.toLowerCase().includes(q))
    : activeGroup.items;
  const showAll = Boolean(showAllByTab[activeTab]);
  const visibleItems = showAll ? matchingGroupItems : matchingGroupItems.slice(0, PALETTE_PAGE_SIZE);
  const hiddenCount = matchingGroupItems.length - visibleItems.length;

  const requiredItems = safeValue.filter((item) => !item.optional);
  const preferredItems = safeValue.filter((item) => item.optional);
  const strictness = strictnessTier(requiredItems.length);

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

      <div className="qe-search-head">
        <span className="qe-search-head-label">Find or add a qualification</span>
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

      <div className="qe-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`qe-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            disabled={disabled}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
          <button
            type="button"
            className="qe-show-all-btn"
            onClick={() => setShowAllByTab((prev) => ({ ...prev, [activeTab]: true }))}
          >
            Show all {matchingGroupItems.length}
          </button>
        )}
      </div>

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
            {strictness} ({requiredItems.length} required)
          </span>
        </div>

        {strictness === "Narrow" && (
          <p className="qe-strictness-warning">
            {requiredItems.length} required items may filter out otherwise-qualified candidates. Consider
            marking some as Preferred instead.
          </p>
        )}

        {safeValue.length === 0 ? (
          <p className="qe-active-empty">
            No qualifications yet. Search above, pick from a category, or start from a role.
          </p>
        ) : (
          <>
            {requiredItems.length > 0 && (
              <div className="qe-active-section">
                <div className="qe-active-section-label">Required</div>
                <div className="qe-active-grid">
                  {safeValue.map((item, index) =>
                    item.optional ? null : (
                      <span key={`${item.type}-${item.value}-${index}`} className="qe-tag">
                        <span className="qe-tag-value">{item.value}</span>
                        <button
                          type="button"
                          className="qe-tag-switch"
                          onClick={() => toggleRequired(index)}
                          disabled={disabled}
                          title="Switch to Preferred"
                        >
                          Required
                        </button>
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
                    )
                  )}
                </div>
              </div>
            )}

            {preferredItems.length > 0 && (
              <div className="qe-active-section">
                <div className="qe-active-section-label">Preferred</div>
                <div className="qe-active-grid">
                  {safeValue.map((item, index) =>
                    !item.optional ? null : (
                      <span key={`${item.type}-${item.value}-${index}`} className="qe-tag is-preferred">
                        <span className="qe-tag-value">{item.value}</span>
                        <button
                          type="button"
                          className="qe-tag-switch is-preferred"
                          onClick={() => toggleRequired(index)}
                          disabled={disabled}
                          title="Switch to Required"
                        >
                          Preferred
                        </button>
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
                    )
                  )}
                </div>
              </div>
            )}
          </>
        )}

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
