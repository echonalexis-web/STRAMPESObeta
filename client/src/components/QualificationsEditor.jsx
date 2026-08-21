import { useState, useMemo } from "react";
import { FaPlus, FaTrash, FaArrowUp, FaArrowDown, FaCheck } from "react-icons/fa";
import "../styles/qualifications-editor.css";
import { COMMON_SKILLS } from "../data/skills";
import { QUALIFICATION_TEMPLATES } from "../data/qualificationsTemplates";
import { usePersistentState } from "../hooks/usePersistentState";

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
  skill: "🔧",
  certification: "📜",
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

export default function QualificationsEditor({
  value = [],
  onChange,
  disabled = false,
  label = "Qualifications",
  required = false,
  showTemplates = true,
}) {
  // Persist internal UI state so that refresh doesn't lose what user typed
  const [internalState, setInternalState, clearInternalState] = usePersistentState('qualificationsEditorState', {
    newType: "skill",
    newValue: "",
    newOptional: false,
    selectedTemplate: "",
  });

  const { newType, newValue, newOptional, selectedTemplate } = internalState;
  const setNewType = (val) => setInternalState(prev => ({ ...prev, newType: val }));
  const setNewValue = (val) => setInternalState(prev => ({ ...prev, newValue: val }));
  const setNewOptional = (val) => setInternalState(prev => ({ ...prev, newOptional: val }));
  const setSelectedTemplate = (val) => setInternalState(prev => ({ ...prev, selectedTemplate: val }));

  // Move qualification up/down
  const moveQualification = (index, direction) => {
    const newList = [...value];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newList.length) return;
    [newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]];
    newList.forEach((q, i) => q.order = i);
    onChange(newList);
  };

  // Remove qualification
  const removeQualification = (index) => {
    const newList = value.filter((_, i) => i !== index);
    newList.forEach((q, i) => q.order = i);
    onChange(newList);
  };

  // Add new qualification
  const addQualification = () => {
    if (!newValue.trim()) return;
    const newQual = {
      type: newType,
      value: newValue.trim(),
      optional: newOptional,
      order: value.length,
    };
    onChange([...value, newQual]);
    setNewValue("");
    setNewOptional(false);
    // Optionally clear the internal persistence after adding? Keep as is.
  };

  // Load template
  const loadTemplate = (templateKey) => {
    if (!templateKey) return;
    const template = QUALIFICATION_TEMPLATES[templateKey];
    if (template) {
      const quals = template.map((q, idx) => ({ ...q, order: idx }));
      onChange(quals);
    }
    setSelectedTemplate("");
  };

  // Handle key press for adding on Enter
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addQualification();
    }
  };

  // Group options for type dropdown with icons
  const typeOptions = TYPE_OPTIONS.map(opt => ({
    ...opt,
    label: `${TYPE_ICONS[opt.value]} ${opt.label}`,
  }));

  const hasQualifications = value && value.length > 0;

  return (
    <div className="qualifications-editor">
      {label && (
        <div className="qualifications-editor-label">
          {label} {required && <span className="required-star">*</span>}
        </div>
      )}

      {/* Template selector */}
      {showTemplates && Object.keys(QUALIFICATION_TEMPLATES).length > 0 && (
        <div className="qualifications-template-section">
          <label className="qualifications-template-label">Load Template</label>
          <div className="qualifications-template-row">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
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
              className="qualifications-template-load-btn"
              onClick={() => loadTemplate(selectedTemplate)}
              disabled={!selectedTemplate || disabled}
            >
              Load
            </button>
          </div>
        </div>
      )}

      {/* Existing qualifications list */}
      {hasQualifications && (
        <div className="qualifications-list">
          {value.map((qual, index) => (
            <div key={index} className="qualifications-item">
              <div className="qualifications-item-content">
                <span className="qualifications-item-type">
                  {TYPE_ICONS[qual.type] || "📌"} {TYPE_LABELS[qual.type] || qual.type}
                </span>
                <span className="qualifications-item-value">{qual.value}</span>
                {qual.optional && (
                  <span className="qualifications-item-optional">(Preferred)</span>
                )}
              </div>
              <div className="qualifications-item-actions">
                <button
                  type="button"
                  className="qualifications-item-btn"
                  onClick={() => moveQualification(index, -1)}
                  disabled={index === 0 || disabled}
                  aria-label="Move up"
                >
                  <FaArrowUp />
                </button>
                <button
                  type="button"
                  className="qualifications-item-btn"
                  onClick={() => moveQualification(index, 1)}
                  disabled={index === value.length - 1 || disabled}
                  aria-label="Move down"
                >
                  <FaArrowDown />
                </button>
                <button
                  type="button"
                  className="qualifications-item-btn qualifications-item-btn-danger"
                  onClick={() => removeQualification(index)}
                  disabled={disabled}
                  aria-label="Remove"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new qualification row */}
      <div className="qualifications-add-row">
        <div className="qualifications-add-field">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            disabled={disabled}
            className="qualifications-add-type"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="qualifications-add-field qualifications-add-value">
          {newType === "skill" ? (
            <input
              type="text"
              list="skill-suggestions"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a skill or qualification..."
              disabled={disabled}
              className="qualifications-add-input"
            />
          ) : (
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter qualification..."
              disabled={disabled}
              className="qualifications-add-input"
            />
          )}
          <datalist id="skill-suggestions">
            {COMMON_SKILLS.map((skill) => (
              <option key={skill} value={skill} />
            ))}
          </datalist>
        </div>

        <div className="qualifications-add-field qualifications-add-optional">
          <label className="qualifications-optional-label">
            <input
              type="checkbox"
              checked={newOptional}
              onChange={(e) => setNewOptional(e.target.checked)}
              disabled={disabled}
            />
            Preferred
          </label>
        </div>

        <button
          type="button"
          className="qualifications-add-btn"
          onClick={addQualification}
          disabled={!newValue.trim() || disabled}
        >
          <FaPlus /> Add
        </button>
      </div>

      {!hasQualifications && (
        <div className="qualifications-empty">No qualifications added yet.</div>
      )}
    </div>
  );
}