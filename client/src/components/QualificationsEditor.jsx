import { useMemo, useState } from "react";
import {
  FaCheck,
  FaClipboardList,
  FaListUl,
  FaPencilAlt,
  FaPlus,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import "../styles/qualifications-editor.css";
import { QUALIFICATION_TEMPLATES } from "../data/qualificationsTemplates";
import { COMMON_SKILLS } from "../data/skills";

const TYPE_LABELS = {
  education: "Education",
  experience: "Experience",
  skill: "Skill",
  certification: "Certification",
  license: "License",
  other: "Other",
};

const TYPE_ICONS = {
  education: "🎓",
  experience: "💼",
  skill: "🧩",
  certification: "✅",
  license: "📄",
  other: "📌",
};

const TYPE_OPTIONS = [
  { value: "education", label: "Education" },
  { value: "experience", label: "Experience" },
  { value: "skill", label: "Skill" },
  { value: "certification", label: "Certification" },
  { value: "license", label: "License" },
  { value: "other", label: "Other" },
];

const normalizeQualification = (qualification, index = 0) => {
  const type = qualification?.type || "skill";
  const value = String(qualification?.value ?? qualification?.text ?? "").trim();

  return {
    type,
    value,
    optional: Boolean(qualification?.optional ?? qualification?.isPreferred),
    order: index,
  };
};

const normalizeQualifications = (qualifications = []) => {
  if (!Array.isArray(qualifications)) return [];
  return qualifications.map((item, index) => normalizeQualification(item, index));
};

const createEmptyEntry = (type = "education") => ({
  type,
  value: "",
  optional: false,
});

export default function QualificationsEditor({
  value = [],
  onChange,
  disabled = false,
  label = "Qualifications",
  required = false,
  showTemplates = true,
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState("");
  const [templateMode, setTemplateMode] = useState("append");
  const [draft, setDraft] = useState(() => normalizeQualifications(value));
  const [customEntry, setCustomEntry] = useState(createEmptyEntry("education"));

  const safeValue = normalizeQualifications(value);

  const openEditor = () => {
    setDraft(normalizeQualifications(value));
    setIsModalOpen(true);
  };

  const closeEditor = () => {
    setIsModalOpen(false);
    setCustomEntry(createEmptyEntry("education"));
    setTemplateKey("");
  };

  const updateDraftItem = (index, patch) => {
    setDraft((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  };

  const removeDraftItem = (index) => {
    setDraft((prev) =>
      prev.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({
        ...item,
        order: itemIndex,
      }))
    );
  };

  const moveDraftItem = (index, direction) => {
    setDraft((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next.map((item, itemIndex) => ({ ...item, order: itemIndex }));
    });
  };

  const addCustomItem = () => {
    const cleanValue = customEntry.value.trim();
    if (!cleanValue) return;

    setDraft((prev) => [
      ...prev,
      {
        type: customEntry.type,
        value: cleanValue,
        optional: Boolean(customEntry.optional),
        order: prev.length,
      },
    ]);

    setCustomEntry((prev) => ({ ...prev, value: "", optional: false }));
  };

  const applyTemplate = () => {
    const template = QUALIFICATION_TEMPLATES[templateKey];
    if (!template) return;

    const templateItems = template.map((item, index) => normalizeQualification(item, index));

    setDraft((prev) => {
      const base = templateMode === "replace" ? [] : prev;
      return [...base, ...templateItems].map((item, itemIndex) => ({
        ...item,
        order: itemIndex,
      }));
    });

    setTemplateKey("");
  };

  const handleApply = () => {
    const nextValue = draft
      .filter((item) => item && String(item.value || "").trim())
      .map((item, index) => ({
        ...item,
        type: item.type || "other",
        value: String(item.value).trim(),
        optional: Boolean(item.optional),
        order: index,
      }));

    onChange(nextValue);
    closeEditor();
  };

  const summaryGroups = useMemo(() => {
    const groups = {
      education: [],
      experience: [],
      skill: [],
      certification: [],
      license: [],
      other: [],
    };

    safeValue.forEach((item) => {
      const type = item.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });

    return Object.entries(groups)
      .filter(([, items]) => items.length)
      .map(([type, items]) => ({ type, items }));
  }, [safeValue]);

  const skillChips = safeValue.filter((item) => item.type === "skill" || item.type === "other");

  return (
    <div className="qualifications-editor">
      {label && (
        <div className="qualifications-editor-label">
          {label}
          {required && <span className="required-star"> *</span>}
        </div>
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
              <button type="button" className="qualifications-edit-btn" onClick={openEditor}>
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
                    {items.slice(0, 3).map((item, index) => (
                      <span key={`${type}-${index}`} className="qualifications-summary-chip">
                        {item.value}
                      </span>
                    ))}
                    {items.length > 3 && (
                      <span className="qualifications-summary-chip more">+{items.length - 3} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {skillChips.length > 0 && (
              <div className="qualifications-skill-cloud">
                {skillChips.slice(0, 10).map((item, index) => (
                  <span key={`${item.type}-${index}`} className="qualifications-skill-pill">
                    {item.value}
                  </span>
                ))}
                {skillChips.length > 10 && (
                  <span className="qualifications-skill-pill more">+{skillChips.length - 10}</span>
                )}
              </div>
            )}

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
                  <h3 className="qualifications-modal-title">Manage Job Qualifications & Requirements</h3>
                  <p className="qualifications-modal-subtitle">Define what candidates need to qualify for this role</p>
                </div>
              </div>
              <button type="button" className="qualifications-close-btn" onClick={closeEditor} aria-label="Close requirements editor">
                <FaTimes />
              </button>
            </div>

            {showTemplates && Object.keys(QUALIFICATION_TEMPLATES).length > 0 && (
              <div className="qualifications-template-section">
                <label className="qualifications-template-label">Load Template</label>
                <div className="qualifications-template-row">
                  <select
                    value={templateKey}
                    onChange={(event) => setTemplateKey(event.target.value)}
                    disabled={disabled}
                    className="qualifications-template-select"
                  >
                    <option value="">-- Select a template --</option>
                    {Object.keys(QUALIFICATION_TEMPLATES).map((key) => (
                      <option key={key} value={key}>
                        {key.replace(/_/g, " ")}
                      </option>
                    ))}
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
                    onClick={applyTemplate}
                    disabled={!templateKey || disabled}
                  >
                    Load
                  </button>
                </div>
              </div>
            )}

            <div className="qualifications-modal-body">
              <div className="qualifications-core-header">
                <span className="qualifications-core-bar" />
                <span>Core Requirements</span>
              </div>

              <div className="qualifications-modal-custom-item">
                <div className="qualifications-modal-custom-selects">
                  <select
                    value={customEntry.type}
                    onChange={(event) =>
                      setCustomEntry((prev) => ({ ...prev, type: event.target.value }))
                    }
                    disabled={disabled}
                  >
                    {TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={customEntry.value}
                    placeholder={
                      customEntry.type === "skill"
                        ? "Select or type a skill"
                        : "Add another requirement or skill"
                    }
                    list={customEntry.type === "skill" ? "qualifications-skill-suggestions" : undefined}
                    onChange={(event) =>
                      setCustomEntry((prev) => ({ ...prev, value: event.target.value }))
                    }
                    disabled={disabled}
                  />
                  {customEntry.type === "skill" && (
                    <datalist id="qualifications-skill-suggestions">
                      {COMMON_SKILLS.map((skill) => (
                        <option key={skill} value={skill} />
                      ))}
                    </datalist>
                  )}

                  <label className="qualifications-checkbox-wrap">
                    <input
                      type="checkbox"
                      checked={customEntry.optional}
                      onChange={(event) =>
                        setCustomEntry((prev) => ({ ...prev, optional: event.target.checked }))
                      }
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

              {draft.length > 0 && (
                <div className="qualifications-draft-list">
                  {draft.map((item, index) => (
                    <div className="qualifications-draft-row" key={`${item.type}-${index}`}>
                      <div className="qualifications-draft-left">
                        <span className="qualifications-draft-type">
                          {TYPE_ICONS[item.type] || "📌"} {TYPE_LABELS[item.type] || item.type}
                        </span>
                        <input
                          type="text"
                          value={item.value}
                          list={item.type === "skill" ? "qualifications-skill-suggestions" : undefined}
                          onChange={(event) =>
                            updateDraftItem(index, { value: event.target.value })
                          }
                        />
                        {item.type === "skill" && (
                          <datalist id="qualifications-skill-suggestions">
                            {COMMON_SKILLS.map((skill) => (
                              <option key={skill} value={skill} />
                            ))}
                          </datalist>
                        )}
                      </div>

                      <div className="qualifications-draft-actions">
                        <label className="qualifications-checkbox-wrap small">
                          <input
                            type="checkbox"
                            checked={Boolean(item.optional)}
                            onChange={(event) =>
                              updateDraftItem(index, { optional: event.target.checked })
                            }
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
                  ))}
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
                  <FaCheck /> Apply & Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}