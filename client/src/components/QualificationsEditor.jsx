import { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaClipboardList,
  FaListUl,
  FaMagic,
  FaPencilAlt,
  FaPlus,
  FaRegSave,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import "../styles/qualifications-editor.css";
import { COMMON_SKILLS } from "../data/skills";
import {
  REQUIREMENT_TYPES,
  STATIC_TEMPLATES,
  TYPE_ICONS,
  TYPE_LABELS,
  foldType,
  groupQualificationsByType,
  isSkillType,
  normalizeQualifications,
  suggestTemplateForTitle,
} from "../utils/qualifications";

const SKILL_DATALIST_ID = "qualifications-skill-suggestions";

// Type options offered on each draft row (skill first, then the non-skill types).
const ROW_TYPE_OPTIONS = [{ value: "skill", label: "Skill" }, ...REQUIREMENT_TYPES];

const dedupeKey = (item) => `${foldType(item.type)}::${String(item.value).trim().toLowerCase()}`;

// Merge `incoming` into `base`, skipping exact (type + value) duplicates.
const mergeItems = (base, incoming) => {
  const seen = new Set(base.map(dedupeKey));
  const merged = [...base];
  incoming.forEach((item) => {
    const key = dedupeKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  });
  return merged.map((item, index) => ({ ...item, order: index }));
};

const createEmptyEntry = () => ({ type: "education", value: "", optional: false });

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draft, setDraft] = useState(safeValue);
  const [templateId, setTemplateId] = useState("");
  const [templateMode, setTemplateMode] = useState("append");
  const [skillInput, setSkillInput] = useState("");
  const [customEntry, setCustomEntry] = useState(createEmptyEntry());

  const [cardTemplateId, setCardTemplateId] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveError, setSaveError] = useState("");

  const suggestion = useMemo(() => {
    if (safeValue.length > 0) return null;
    return suggestTemplateForTitle(resolvedTemplates, jobTitleHint);
  }, [safeValue.length, resolvedTemplates, jobTitleHint]);

  const summaryGroups = useMemo(() => groupQualificationsByType(safeValue), [safeValue]);

  // Keep the draft in sync whenever the editor is (re)opened.
  useEffect(() => {
    if (isModalOpen) setDraft(safeValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  const openEditor = () => {
    setDraft(safeValue);
    setSkillInput("");
    setCustomEntry(createEmptyEntry());
    setTemplateId("");
    setShowTemplateSave(false);
    setTemplateName("");
    setSaveError("");
    setIsModalOpen(true);
  };

  const closeEditor = () => {
    setIsModalOpen(false);
  };

  // ---- On-page template loader (works without opening the modal) ----------
  const loadTemplateIntoValue = (id, { replace = false } = {}) => {
    const template = resolvedTemplates.find((tpl) => String(tpl.id) === String(id));
    if (!template) return;
    const items = normalizeQualifications(template.items);
    const next = replace ? items.map((item, i) => ({ ...item, order: i })) : mergeItems(safeValue, items);
    onChange(next);
  };

  const handleCardTemplateChange = (event) => {
    const id = event.target.value;
    setCardTemplateId("");
    if (!id) return;
    loadTemplateIntoValue(id, { replace: safeValue.length === 0 });
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    loadTemplateIntoValue(suggestion.id, { replace: true });
  };

  // ---- Draft mutations --------------------------------------------------
  const updateDraftItem = (index, patch) => {
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeDraftItem = (index) => {
    setDraft((prev) =>
      prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i }))
    );
  };

  const moveDraftItem = (index, direction) => {
    setDraft((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, i) => ({ ...item, order: i }));
    });
  };

  // Skills: accept one or many (comma / newline separated) at once.
  const addSkills = () => {
    const parts = skillInput
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setDraft((prev) =>
      mergeItems(
        prev,
        parts.map((value) => ({ type: "skill", value, optional: false }))
      )
    );
    setSkillInput("");
  };

  const addCustomItem = () => {
    const clean = customEntry.value.trim();
    if (!clean) return;
    setDraft((prev) =>
      mergeItems(prev, [{ type: customEntry.type, value: clean, optional: Boolean(customEntry.optional) }])
    );
    setCustomEntry((prev) => ({ ...prev, value: "", optional: false }));
  };

  const applyModalTemplate = () => {
    const template = resolvedTemplates.find((tpl) => String(tpl.id) === String(templateId));
    if (!template) return;
    const items = normalizeQualifications(template.items);
    setDraft((prev) =>
      templateMode === "replace"
        ? items.map((item, i) => ({ ...item, order: i }))
        : mergeItems(prev, items)
    );
    setTemplateId("");
  };

  const handleApply = () => {
    const next = draft
      .map((item, index) => ({
        type: foldType(item.type),
        value: String(item.value || "").trim(),
        optional: Boolean(item.optional),
        order: index,
      }))
      .filter((item) => item.value)
      .map((item, index) => ({ ...item, order: index }));
    onChange(next);
    closeEditor();
  };

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) return;
    const name = templateName.trim();
    if (!name) {
      setSaveError("Give the template a name");
      return;
    }
    const items = draft
      .map((item) => ({
        type: foldType(item.type),
        value: String(item.value || "").trim(),
        optional: Boolean(item.optional),
      }))
      .filter((item) => item.value);
    if (!items.length) {
      setSaveError("Add at least one requirement first");
      return;
    }
    setSavingTemplate(true);
    setSaveError("");
    try {
      await onSaveTemplate({ name, items });
      setShowTemplateSave(false);
      setTemplateName("");
    } catch (err) {
      setSaveError(err?.response?.data?.message || "Could not save template");
    } finally {
      setSavingTemplate(false);
    }
  };

  const draftSkills = draft.filter((item) => isSkillType(item.type));
  const templateOptions = resolvedTemplates.map((tpl) => (
    <option key={tpl.id} value={tpl.id}>
      {tpl.name}
      {tpl.source === "custom" ? " (yours)" : ""}
    </option>
  ));

  return (
    <div className="qualifications-editor">
      {/* One shared datalist for every skill input on the page. */}
      <datalist id={SKILL_DATALIST_ID}>
        {COMMON_SKILLS.map((skill) => (
          <option key={skill} value={skill} />
        ))}
      </datalist>

      {label && (
        <div className="qualifications-editor-label">
          {label}
          {required && <span className="required-star"> *</span>}
        </div>
      )}

      {/* On-page "Start from a template" dropdown — always visible, no modal. */}
      {showTemplates && resolvedTemplates.length > 0 && (
        <div className="qualifications-quick-template">
          <label htmlFor="qualifications-quick-template-select">
            <FaListUl /> Start from a template
          </label>
          <select
            id="qualifications-quick-template-select"
            value={cardTemplateId}
            onChange={handleCardTemplateChange}
            disabled={disabled}
          >
            <option value="">
              {safeValue.length === 0 ? "-- Choose a template to prefill --" : "-- Add a template's items --"}
            </option>
            {templateOptions}
          </select>
        </div>
      )}

      {suggestion && (
        <button
          type="button"
          className="qualifications-suggestion"
          onClick={applySuggestion}
          disabled={disabled}
        >
          <FaMagic /> Use the <strong>{suggestion.name}</strong> template for &ldquo;{jobTitleHint}&rdquo;?
        </button>
      )}

      <div className="qualifications-card-shell">
        {safeValue.length === 0 ? (
          <div className="qualifications-empty-state">
            <div className="qualifications-empty-icon">
              <FaClipboardList />
            </div>
            <div className="qualifications-empty-text">No qualifications added yet</div>
            <div className="qualifications-empty-subtext">
              Define what candidates need to qualify for this role
            </div>
            <button
              type="button"
              className="qualifications-primary-btn"
              onClick={openEditor}
              disabled={disabled}
            >
              <FaPlus /> Add / Edit Qualifications
            </button>
          </div>
        ) : (
          <div className="qualifications-summary-card">
            <div className="qualifications-summary-header">
              <div className="qualifications-summary-title">
                <FaListUl /> Requirements Overview
              </div>
              <button type="button" className="qualifications-edit-btn" onClick={openEditor} disabled={disabled}>
                <FaPencilAlt /> Edit
              </button>
            </div>

            <div className="qualifications-summary-list">
              {summaryGroups.map(({ type, items }) => (
                <div className="qualifications-summary-group" key={type}>
                  <div className="qualifications-summary-group-label">
                    {TYPE_ICONS[type] || "📌"} {TYPE_LABELS[type] || type}
                  </div>
                  <div className="qualifications-summary-values">
                    {items.slice(0, 6).map((item, index) => (
                      <span key={`${type}-${index}`} className="qualifications-summary-chip">
                        {item.value}
                        {item.optional ? " · preferred" : ""}
                      </span>
                    ))}
                    {items.length > 6 && (
                      <span className="qualifications-summary-chip more">+{items.length - 6} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="qualifications-summary-total">
              {safeValue.length} requirement{safeValue.length === 1 ? "" : "s"} set
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="qualifications-modal-backdrop" onClick={closeEditor}>
          <div className="qualifications-modal" onClick={(event) => event.stopPropagation()}>
            <div className="qualifications-modal-header">
              <div className="qualifications-modal-title-wrap">
                <div className="qualifications-modal-icon">
                  <FaClipboardList />
                </div>
                <div>
                  <h3 className="qualifications-modal-title">Manage Job Qualifications &amp; Requirements</h3>
                  <p className="qualifications-modal-subtitle">
                    Define what candidates need to qualify for this role
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="qualifications-close-btn"
                onClick={closeEditor}
                aria-label="Close requirements editor"
              >
                <FaTimes />
              </button>
            </div>

            {showTemplates && resolvedTemplates.length > 0 && (
              <div className="qualifications-template-section">
                <label className="qualifications-template-label">Load Template</label>
                <div className="qualifications-template-row">
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    disabled={disabled}
                    className="qualifications-template-select"
                  >
                    <option value="">-- Select a template --</option>
                    {templateOptions}
                  </select>
                  <button
                    type="button"
                    className="qualifications-template-mode-btn"
                    onClick={() => setTemplateMode((prev) => (prev === "append" ? "replace" : "append"))}
                  >
                    {templateMode === "append" ? "Append" : "Replace"}
                  </button>
                  <button
                    type="button"
                    className="qualifications-template-load-btn"
                    onClick={applyModalTemplate}
                    disabled={!templateId || disabled}
                  >
                    Load
                  </button>
                </div>
              </div>
            )}

            <div className="qualifications-modal-body">
              {/* ---- Merged skills bucket ---- */}
              <div className="qualifications-core-header">
                <span className="qualifications-core-bar" />
                <span>Skills &amp; Competencies</span>
              </div>

              <div className="qualifications-skill-adder">
                <input
                  type="text"
                  value={skillInput}
                  list={SKILL_DATALIST_ID}
                  placeholder="Type a skill and press Enter (or paste a comma-separated list)"
                  onChange={(event) => setSkillInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSkills();
                    }
                  }}
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="qualifications-inline-add-btn"
                  onClick={addSkills}
                  disabled={!skillInput.trim() || disabled}
                >
                  <FaPlus /> Add
                </button>
              </div>

              {draftSkills.length > 0 && (
                <div className="qualifications-skill-chips">
                  {draft.map((item, index) =>
                    isSkillType(item.type) ? (
                      <span
                        key={`skill-${index}`}
                        className={`qualifications-skill-chip ${item.optional ? "preferred" : ""}`}
                      >
                        <button
                          type="button"
                          className="qualifications-skill-chip-preferred"
                          title={item.optional ? "Marked preferred — click to make required" : "Mark as preferred"}
                          onClick={() => updateDraftItem(index, { optional: !item.optional })}
                        >
                          {item.optional ? "★" : "☆"}
                        </button>
                        {item.value}
                        <button
                          type="button"
                          className="qualifications-skill-chip-remove"
                          onClick={() => removeDraftItem(index)}
                          aria-label={`Remove ${item.value}`}
                        >
                          <FaTimes />
                        </button>
                      </span>
                    ) : null
                  )}
                </div>
              )}

              {/* ---- Non-skill requirements ---- */}
              <div className="qualifications-core-header" style={{ marginTop: "1.25rem" }}>
                <span className="qualifications-core-bar" />
                <span>Other Requirements</span>
              </div>

              <div className="qualifications-modal-custom-item">
                <div className="qualifications-modal-custom-selects">
                  <select
                    value={customEntry.type}
                    onChange={(event) => setCustomEntry((prev) => ({ ...prev, type: event.target.value }))}
                    disabled={disabled}
                  >
                    {REQUIREMENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={customEntry.value}
                    placeholder="e.g. Bachelor's degree in Accounting"
                    onChange={(event) => setCustomEntry((prev) => ({ ...prev, value: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomItem();
                      }
                    }}
                    disabled={disabled}
                  />

                  <label className="qualifications-checkbox-wrap">
                    <input
                      type="checkbox"
                      checked={customEntry.optional}
                      onChange={(event) => setCustomEntry((prev) => ({ ...prev, optional: event.target.checked }))}
                      disabled={disabled}
                    />
                    Preferred
                  </label>
                </div>

                <button
                  type="button"
                  className="qualifications-inline-add-btn"
                  onClick={addCustomItem}
                  disabled={!customEntry.value.trim() || disabled}
                >
                  <FaPlus /> Add
                </button>
              </div>

              {draft.some((item) => !isSkillType(item.type)) && (
                <div className="qualifications-draft-list">
                  {draft.map((item, index) =>
                    isSkillType(item.type) ? null : (
                      <div className="qualifications-draft-row" key={`${item.type}-${index}`}>
                        <div className="qualifications-draft-left">
                          <select
                            className="qualifications-draft-type-select"
                            value={foldType(item.type)}
                            onChange={(event) => updateDraftItem(index, { type: event.target.value })}
                          >
                            {ROW_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={item.value}
                            onChange={(event) => updateDraftItem(index, { value: event.target.value })}
                          />
                        </div>

                        <div className="qualifications-draft-actions">
                          <label className="qualifications-checkbox-wrap small">
                            <input
                              type="checkbox"
                              checked={Boolean(item.optional)}
                              onChange={(event) => updateDraftItem(index, { optional: event.target.checked })}
                            />
                            Preferred
                          </label>

                          <button
                            type="button"
                            className="qualifications-move-btn"
                            onClick={() => moveDraftItem(index, -1)}
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="qualifications-move-btn"
                            onClick={() => moveDraftItem(index, 1)}
                            disabled={index === draft.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="qualifications-remove-btn"
                            onClick={() => removeDraftItem(index)}
                            aria-label="Remove requirement"
                          >
                            <FaTrash />
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {onSaveTemplate && (
                <div className="qualifications-save-template">
                  {showTemplateSave ? (
                    <div className="qualifications-save-template-form">
                      <input
                        type="text"
                        value={templateName}
                        placeholder="Template name (e.g. Kitchen Staff)"
                        onChange={(event) => setTemplateName(event.target.value)}
                        disabled={savingTemplate}
                      />
                      <button
                        type="button"
                        className="qualifications-template-load-btn"
                        onClick={handleSaveTemplate}
                        disabled={savingTemplate || !templateName.trim()}
                      >
                        {savingTemplate ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        className="qualifications-cancel-btn"
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
                      className="qualifications-save-template-btn"
                      onClick={() => {
                        setShowTemplateSave(true);
                        setTemplateName("");
                        setSaveError("");
                      }}
                      disabled={draft.length === 0}
                    >
                      <FaRegSave /> Save these as a reusable template
                    </button>
                  )}
                  {saveError && <div className="qualifications-save-template-error">{saveError}</div>}
                </div>
              )}
            </div>

            <div className="qualifications-modal-footer">
              <div className="qualifications-modal-total">
                {draft.length} requirement{draft.length === 1 ? "" : "s"} total
              </div>

              <div className="qualifications-modal-actions">
                <button type="button" className="qualifications-cancel-btn" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="button" className="qualifications-apply-btn" onClick={handleApply}>
                  <FaCheck /> Apply &amp; Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
