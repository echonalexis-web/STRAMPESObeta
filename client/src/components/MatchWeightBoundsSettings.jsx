import { useEffect, useState } from "react";
import { superadminAPI } from "../services/api";
import { DIMENSION_ORDER, DIMENSION_LABELS } from "../utils/qualifications";

const DEFAULT_BOUND = { min: 0, max: 100 };

function buildDefaultBounds() {
  const bounds = {};
  DIMENSION_ORDER.forEach((key) => { bounds[key] = { ...DEFAULT_BOUND }; });
  return bounds;
}

/**
 * Per-criterion {min, max} bounds (§C.1) every employer's and admin's
 * weight profile must fall within — the primary defence against an
 * employer zeroing out a criterion that should always matter, or maxing
 * one (location, especially) that acts as an exclusionary proxy.
 * Superadmin-only, matching the companion plan's endpoint table
 * (`GET/PUT /api/admin/match-weight-bounds | superadmin`) — this is why it
 * lives here in SuperadminConsole rather than the plain AdminDashboard
 * (see MatchWeightDefaultsSettings.jsx for the admin-reachable platform
 * defaults editor).
 *
 * Reuses SuperadminConsole's `sac__card` / `sac__primary` / `sac__ghost`
 * classes (the same ones NsrpTemplateSettings.jsx sits beside) rather than
 * inventing a new visual pattern.
 *
 * NOTE: the server endpoint this calls does not exist yet — see
 * markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this UI was
 * built against.
 */
export default function MatchWeightBoundsSettings() {
  const [draft, setDraft] = useState(buildDefaultBounds);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage({ text: "", error: false });
    superadminAPI.getMatchWeightBounds()
      .then((res) => {
        if (cancelled) return;
        const fetched = res.data?.bounds || {};
        const merged = buildDefaultBounds();
        DIMENSION_ORDER.forEach((key) => {
          if (fetched[key]) merged[key] = { min: Number(fetched[key].min) || 0, max: Number(fetched[key].max) || 100 };
        });
        setDraft(merged);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage({
          text: err.response?.status === 404
            ? "Not available yet — this feature's backend is still being built."
            : err.response?.data?.message || "Failed to load matching weight bounds.",
          error: true,
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setBound = (key, field, value) => {
    const n = Math.max(0, Math.min(100, Number(value) || 0));
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], [field]: n } }));
  };

  const invalidKeys = DIMENSION_ORDER.filter((key) => draft[key].min > draft[key].max);
  const isValid = invalidKeys.length === 0;

  const handleSave = async () => {
    setSaving(true);
    setMessage({ text: "", error: false });
    try {
      const res = await superadminAPI.updateMatchWeightBounds({ bounds: draft });
      if (res.data?.bounds) setDraft(res.data.bounds);
      setMessage({ text: "Matching weight bounds saved.", error: false });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || "Failed to save.", error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sac__card mwb" aria-labelledby="match-weight-bounds-title">
      <header className="mwb__head">
        <h2 id="match-weight-bounds-title">Matching Weight Bounds</h2>
        <p className="mwb__subtitle">
          The minimum and maximum percentage employers can set for each job-matching criterion.
          Keeps any one factor (especially Location) from being tuned to exclude candidates for
          reasons unrelated to the job.
        </p>
      </header>

      {message.text && (
        <p className={`mwb__message ${message.error ? "is-error" : "is-ok"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {loading && !loaded ? (
        <p className="loading">Loading...</p>
      ) : loaded ? (
        <>
          <div className="mwb__grid">
            <div className="mwb__row mwb__row--header">
              <span>Criterion</span>
              <span>Min %</span>
              <span>Max %</span>
            </div>
            {DIMENSION_ORDER.map((key) => {
              const invalid = draft[key].min > draft[key].max;
              return (
                <div className={`mwb__row ${invalid ? "is-invalid" : ""}`} key={key}>
                  <span className="mwb__label">{DIMENSION_LABELS[key]}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft[key].min}
                    disabled={saving}
                    onChange={(e) => setBound(key, "min", e.target.value)}
                    aria-label={`${DIMENSION_LABELS[key]} minimum percent`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft[key].max}
                    disabled={saving}
                    onChange={(e) => setBound(key, "max", e.target.value)}
                    aria-label={`${DIMENSION_LABELS[key]} maximum percent`}
                  />
                </div>
              );
            })}
          </div>

          {!isValid && (
            <p className="mwb__message is-error" role="alert">
              Minimum can't exceed maximum for: {invalidKeys.map((k) => DIMENSION_LABELS[k]).join(", ")}.
            </p>
          )}

          <button type="button" className="sac__primary" onClick={handleSave} disabled={!isValid || saving}>
            {saving ? "Saving…" : "Save bounds"}
          </button>
        </>
      ) : null}
    </section>
  );
}
