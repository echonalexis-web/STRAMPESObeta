import { useEffect, useMemo, useState } from "react";
import {
  FaCheck,
  FaClipboardList,
  FaListUl,
  FaMagic,
  FaPencilAlt,
  FaPlus,
  FaRegSave,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import "../styles/qualifications-editor.css";
import { COMMON_SKILLS } from "../data/skills";
import { MODAL_TAG_GROUPS } from "../data/jobRequirements";
import {
  REQUIREMENT_TYPES,
  STATIC_TEMPLATES,
  foldType,
  normalizeQualifications,
  suggestTemplateForTitle,
} from "../utils/qualifications";

const SKILL_DATALIST_ID = "qualifications-skill-suggestions";

// Type options offered on the custom-item row (skill first, then the rest).
const ROW_TYPE_OPTIONS = [{ value: "skill", label: "Skill" }, ...REQUIREMENT_TYPES];

// Tabs shown in the modal palette. "all" is the union of every group.
const MODAL_TABS = [{ id: "all", label: "All" }, ...MODAL_TAG_GROUPS.map((g) => ({ id: g.id, label: g.label }))];
const ALL_TAG_ITEMS = MODAL_TAG_GROUPS.flatMap((g) => g.items);

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

const createEmptyEntry = () => ({ type: "skill", value: "", optional: false });

const sameItem = (item, value, type) =>
  foldType(item.type) === foldType(type) &&
  String(item.value).trim().toLowerCase() === String(value).trim().toLowerCase();

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
  const [customEntry, setCustomEntry] = useState(createEmptyEntry());

  const [modalSearch, setModalSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [cardTemplateId, setCardTemplateId] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [saveError, setSaveError] = useState("");

  const suggestion = useMemo(() => {
    if (safeValue.length > 0) return null;
    return suggestTemplateForTitle(resolvedTemplates, jobTitleHint);
  }, [safeValue.length, resolvedTemplates, jobTitleHint]);

  // Keep the draft in sync whenever the editor is (re)opened.
  useEffect(() => {
    if (isModalOpen) setDraft(safeValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  const openEditor = () => {
    setDraft(safeValue);
    setModalSearch("");
    setActiveTab("all");
    setCustomEntry(createEmptyEntry());
    setTemplateId("");
    setShowTemplateSave(false);
    setTemplateName("");
    setSaveError("");
    setIsModalOpen(true);
  };

  const closeEditor = () => setIsModalOpen(false);

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

  const removeFromValue = (index) => {
    onChange(safeValue.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i })));
  };

  // ---- Draft mutations --------------------------------------------------
  const updateDraftItem = (index, patch) => {
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeDraftItem = (index) => {
    setDraft((prev) => prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i })));
  };

  const addCustomItem = () => {
    const clean = customEntry.value.trim();
    if (!clean) return;
    setDraft((prev) =>
      mergeItems(prev, [{ type: customEntry.type, value: clean, optional: Boolean(customEntry.optional) }])
    );
    setCustomEntry(createEmptyEntry());
  };

  const draftHas = (value, type) => draft.some((item) => sameItem(item, value, type));

  const toggleItem = (value, type) => {
    setDraft((prev) => {
      const exists = prev.some((item) => sameItem(item, value, type));
      if (exists) {
        return prev.filter((item) => !sameItem(item, value, type)).map((item, index) => ({ ...item, order: index }));
      }
      return mergeItems(prev, [{ type, value, optional: false }]);
    });
  };

  const applyModalTemplate = () => {
    const template = resolvedTemplates.find((tpl) => String(tpl.id) === String(templateId));
    if (!template) return;
    const items = normalizeQualifications(template.items);
    setDraft((prev) =>
      templateMode === "replace" ? items.map((item, i) => ({ ...item, order: i })) : mergeItems(prev, items)
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

  const templateOptions = resolvedTemplates.map((tpl) => (
    <option key={tpl.id} value={tpl.id}>
      {tpl.name}
      {tpl.source === "custom" ? " (yours)" : ""}
    </option>
  ));

  // ---- Modal palette: filter by tab + search --------------------------
  const visibleGroups = useMemo(() => {
    const q = modalSearch.trim().toLowerCase();
    const base =
      activeTab === "all"
        ? MODAL_TAG_GROUPS
        : MODAL_TAG_GROUPS.filter((group) => group.id === activeTab);
    return base
      .map((group) => ({
        ...group,
        items: q ? group.items.filter((item) => item.value.toLowerCase().includes(q)) : group.items,
      }))
      .filter((group) => group.items.length > 0);
  }, [activeTab, modalSearch]);

  const searchMisses = useMemo(() => {
    const q = modalSearch.trim().toLowerCase();
    if (!q) return false;
    return !ALL_TAG_ITEMS.some((item) => item.value.toLowerCase().includes(q));
  }, [modalSearch]);

  return (
    <div className="qe">
      {/* One shared datalist for every skill input on the page. */}
      <datalist id={SKILL_DATALIST_ID}>
        {COMMON_SKILLS.map((skill) => (
          <option key={skill} value={skill} />
        ))}
      </datalist>

      {label && (
        <div className="qe-label">
          {label}
          {required && <span className="qe-req-star"> *</span>}
        </div>
      )}

      {/* On-page "Start from a template" dropdown — always visible, no modal. */}
      {showTemplates && resolvedTemplates.length > 0 && (
        <div className="qe-quick-template">
          <label htmlFor="qe-quick-template-select">
            <FaListUl /> Start from a template
          </label>
          <select
            id="qe-quick-template-select"
            value={cardTemplateId}
            onChange={handleCardTemplateChange}
            disabled={disabled}
          >
            <option value="">
              {safeValue.length === 0 ? "Choose a template to prefill" : "Add a template's items"}
            </option>
            {templateOptions}
          </select>
        </div>
      )}

      {suggestion && (
        <button type="button" className="qe-suggestion" onClick={applySuggestion} disabled={disabled}>
          <FaMagic /> Use the <strong>{suggestion.name}</strong> template for &ldquo;{jobTitleHint}&rdquo;?
        </button>
      )}

      {/* ---- In-page active qualifications ---- */}
      <div className="qe-active">
        <div className="qe-active-head">
          <div className="qe-active-title">
            <FaListUl />
            <span>Active qualifications</span>
            <span className="qe-count">{safeValue.length}</span>
          </div>
          <button type="button" className="qe-manage-btn" onClick={openEditor} disabled={disabled}>
            {safeValue.length === 0 ? <FaPlus /> : <FaPencilAlt />}
            {safeValue.length === 0 ? "Add qualifications" : "Manage"}
          </button>
        </div>

        {safeValue.length === 0 ? (
          <p className="qe-active-empty">
            No qualifications yet. Add the skills, licences and clearances a candidate needs
            &mdash; or start from a template above.
          </p>
        ) : (
          <div className="qe-active-grid">
            {safeValue.map((item, index) => (
              <span key={`${item.type}-${item.value}-${index}`} className="qe-tag">
                <span className="qe-tag-value">{item.value}</span>
                <span className={`qe-tag-status ${item.optional ? "is-preferred" : "is-required"}`}>
                  {item.optional ? "Preferred" : "Required"}
                </span>
                <button
                  type="button"
                  className="qe-tag-remove"
                  onClick={() => removeFromValue(index)}
                  disabled={disabled}
                  aria-label={`Remove ${item.value}`}
                >
                  <FaTimes />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="qe-modal-backdrop" onClick={closeEditor}>
          <div
            className="qe-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Manage qualifications and requirements"
          >
            {/* Header */}
            <div className="qe-modal-head">
              <div className="qe-modal-head-top">
                <div className="qe-modal-head-title">
                  <span className="qe-modal-icon"><FaClipboardList /></span>
                  <div>
                    <h3>Manage qualifications &amp; requirements</h3>
                    <p>Search, browse by category, or add your own. Set each as required or preferred below.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="qe-modal-close"
                  onClick={closeEditor}
                  aria-label="Close"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="qe-search">
                <FaSearch />
                <input
                  type="search"
                  value={modalSearch}
                  placeholder="Search skills, licences, clearances…"
                  onChange={(event) => setModalSearch(event.target.value)}
                  disabled={disabled}
                />
              </div>

              {showTemplates && resolvedTemplates.length > 0 && (
                <div className="qe-template-row">
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    disabled={disabled}
                  >
                    <option value="">Load a template…</option>
                    {templateOptions}
                  </select>
                  <button
                    type="button"
                    className="qe-ghost-btn"
                    onClick={() => setTemplateMode((prev) => (prev === "append" ? "replace" : "append"))}
                  >
                    {templateMode === "append" ? "Append" : "Replace"}
                  </button>
                  <button
                    type="button"
                    className="qe-ghost-btn"
                    onClick={applyModalTemplate}
                    disabled={!templateId || disabled}
                  >
                    Load
                  </button>
                </div>
              )}

              <div className="qe-tabs" role="tablist">
                {MODAL_TABS.map((tab) => (
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
            </div>

            {/* Body: pill palette + custom item */}
            <div className="qe-modal-body">
              {visibleGroups.length === 0 ? (
                <p className="qe-palette-empty">
                  {searchMisses
                    ? "Nothing matches that. Add it as a custom requirement below."
                    : "No items in this category."}
                </p>
              ) : (
                visibleGroups.map((group) => (
                  <div className="qe-palette-group" key={group.id}>
                    <div className="qe-palette-group-label">{group.label}</div>
                    <div className="qe-palette">
                      {group.items.map((item) => {
                        const active = draftHas(item.value, item.type);
                        return (
                          <button
                            key={`${item.type}-${item.value}`}
                            type="button"
                            className={`qe-palette-pill ${active ? "is-active" : ""}`}
                            onClick={() => toggleItem(item.value, item.type)}
                            disabled={disabled}
                          >
                            {active ? <FaCheck /> : <FaPlus />}
                            {item.value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}

              <div className="qe-custom">
                <div className="qe-custom-label">Add a custom requirement</div>
                <div className="qe-custom-row">
                  <select
                    className="qe-custom-type"
                    value={customEntry.type}
                    onChange={(event) => setCustomEntry((prev) => ({ ...prev, type: event.target.value }))}
                    disabled={disabled}
                    aria-label="Requirement type"
                  >
                    {ROW_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="qe-custom-input"
                    value={customEntry.value}
                    list={SKILL_DATALIST_ID}
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
                  <div className="qe-seg" role="group" aria-label="Required or preferred">
                    <button
                      type="button"
                      className={`qe-seg-btn ${!customEntry.optional ? "is-active" : ""}`}
                      onClick={() => setCustomEntry((prev) => ({ ...prev, optional: false }))}
                      disabled={disabled}
                    >
                      Required
                    </button>
                    <button
                      type="button"
                      className={`qe-seg-btn ${customEntry.optional ? "is-active" : ""}`}
                      onClick={() => setCustomEntry((prev) => ({ ...prev, optional: true }))}
                      disabled={disabled}
                    >
                      Preferred
                    </button>
                  </div>
                  <button
                    type="button"
                    className="qe-add-btn"
                    onClick={addCustomItem}
                    disabled={!customEntry.value.trim() || disabled}
                  >
                    <FaPlus /> Add
                  </button>
                </div>
              </div>

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
                      disabled={draft.length === 0}
                    >
                      <FaRegSave /> Save these as a reusable template
                    </button>
                  )}
                  {saveError && <div className="qe-save-template-error">{saveError}</div>}
                </div>
              )}
            </div>

            {/* Sticky selected drawer */}
            <div className="qe-drawer">
              <div className="qe-drawer-head">
                <span className="qe-drawer-title">
                  Selected <span className="qe-count">{draft.length}</span>
                </span>
                {draft.length > 0 && (
                  <button
                    type="button"
                    className="qe-link-btn"
                    onClick={() => setDraft([])}
                    disabled={disabled}
                  >
                    Clear all
                  </button>
                )}
              </div>

              {draft.length === 0 ? (
                <p className="qe-drawer-empty">Nothing selected yet — pick from the palette or add a custom item.</p>
              ) : (
                <div className="qe-drawer-chips">
                  {draft.map((item, index) => (
                    <span key={`${item.type}-${item.value}-${index}`} className="qe-chip">
                      <span className="qe-chip-value">{item.value}</span>
                      <span className="qe-chip-seg" role="group">
                        <button
                          type="button"
                          className={`qe-chip-seg-btn ${!item.optional ? "is-active" : ""}`}
                          onClick={() => updateDraftItem(index, { optional: false })}
                          title="Required"
                        >
                          Req
                        </button>
                        <button
                          type="button"
                          className={`qe-chip-seg-btn ${item.optional ? "is-active" : ""}`}
                          onClick={() => updateDraftItem(index, { optional: true })}
                          title="Preferred"
                        >
                          Pref
                        </button>
                      </span>
                      <button
                        type="button"
                        className="qe-chip-remove"
                        onClick={() => removeDraftItem(index)}
                        aria-label={`Remove ${item.value}`}
                      >
                        <FaTimes />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="qe-drawer-actions">
                <button type="button" className="qe-ghost-btn" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="button" className="qe-apply-btn" onClick={handleApply}>
                  <FaCheck /> Apply &amp; save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
