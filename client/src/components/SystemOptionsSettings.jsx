import { useEffect, useState } from "react";
import { systemOptionsAPI } from "../services/api";

/**
 * Admin-maintainable catalogs (item 11,
 * markdowns/MOCK_DEFENSE_REVISION_STATUS.md) — industries, job types,
 * government ID types. Deliberately NOT extended to application statuses
 * (wired into scoring/notifications/audit), municipalities (a large PH
 * government geographic reference file), or education levels (ordinal) —
 * see the revision-status doc for why those stay as code.
 *
 * Superadmin-only (matches MatchWeightBoundsSettings.jsx's precedent for
 * catalog/schema-shaping admin actions), reuses the same sac__card /
 * sac__primary / sac__ghost visual pattern.
 */
const CATEGORIES = [
  { key: "industry", label: "Industries" },
  { key: "jobType", label: "Job Types" },
  { key: "governmentIdType", label: "Government ID Types" },
];

export default function SystemOptionsSettings() {
  const [activeCategory, setActiveCategory] = useState("industry");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: "", error: false });
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = (category) => {
    setLoading(true);
    setMessage({ text: "", error: false });
    systemOptionsAPI
      .list(category, { includeInactive: "true" })
      .then((res) => setOptions(Array.isArray(res.data?.options) ? res.data.options : []))
      .catch((err) => {
        setOptions([]);
        setMessage({ text: err.response?.data?.message || "Failed to load options.", error: true });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(activeCategory);
    setNewValue("");
  }, [activeCategory]);

  const handleAdd = async (event) => {
    event.preventDefault();
    const trimmed = newValue.trim();
    if (!trimmed) return;
    setAdding(true);
    setMessage({ text: "", error: false });
    try {
      await systemOptionsAPI.create({ category: activeCategory, value: trimmed, order: options.length });
      setNewValue("");
      load(activeCategory);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || "Failed to add option.", error: true });
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (option) => {
    setBusyId(option._id);
    setMessage({ text: "", error: false });
    try {
      await systemOptionsAPI.update(option._id, { isActive: !option.isActive });
      load(activeCategory);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || "Failed to update option.", error: true });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (option) => {
    setBusyId(option._id);
    setMessage({ text: "", error: false });
    try {
      await systemOptionsAPI.remove(option._id);
      load(activeCategory);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || "Failed to delete option.", error: true });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="sac__card so" aria-labelledby="system-options-title">
      <header className="mwb__head">
        <h2 id="system-options-title">Dropdown Catalogs</h2>
        <p className="mwb__subtitle">
          Add, retire, or remove the options applicants and employers see in the industry, job
          type, and government ID dropdowns — changes apply without a redeploy.
        </p>
      </header>

      <div className="so__tabs" role="tablist" aria-label="Catalog category">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            role="tab"
            aria-selected={activeCategory === cat.key}
            className={`so__tab ${activeCategory === cat.key ? "is-active" : ""}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {message.text && (
        <p className={`mwb__message ${message.error ? "is-error" : "is-ok"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <form className="so__add-row" onSubmit={handleAdd}>
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Add a new option…"
          disabled={adding}
        />
        <button type="submit" className="sac__primary" disabled={adding || !newValue.trim()}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {loading ? (
        <p className="loading">Loading…</p>
      ) : options.length === 0 ? (
        <p className="so__empty">No options in this category yet.</p>
      ) : (
        <ul className="so__list">
          {options.map((option) => (
            <li key={option._id} className={`so__item ${option.isActive ? "" : "is-inactive"}`}>
              <span className="so__value">{option.value}</span>
              {!option.isActive && <span className="so__badge">Inactive</span>}
              <div className="so__item-actions">
                <button
                  type="button"
                  className="sac__ghost"
                  disabled={busyId === option._id}
                  onClick={() => toggleActive(option)}
                >
                  {option.isActive ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  type="button"
                  className="sac__ghost so__delete"
                  disabled={busyId === option._id}
                  onClick={() => handleDelete(option)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
