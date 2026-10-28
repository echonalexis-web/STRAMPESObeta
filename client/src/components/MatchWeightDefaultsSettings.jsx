import { useEffect, useState } from "react";
import { FaSlidersH } from "react-icons/fa";
import { adminAPI } from "../services/api";
import { CODE_FALLBACK_WEIGHTS } from "../utils/qualifications";
import MatchWeightsEditor from "./MatchWeightsEditor";

/**
 * Platform-default job-matching weight profile (§C.1) — what every employer
 * inherits before customising their own, and the reset target for their
 * "Reset to platform default" button. Reachable by both "admin" and
 * "superadmin" (unlike the per-criterion bounds editor, which is
 * superadmin-only — see MatchWeightBoundsSettings.jsx in SuperadminConsole),
 * matching the companion plan's own endpoint table
 * (`GET/PUT /api/admin/match-weight-defaults | admin`).
 *
 * Styled with the `admin-panel-card` / `admin-card-header` classes
 * AdminDashboard.jsx's chart panels already use, for visual consistency
 * with the rest of that page.
 *
 * NOTE: the server endpoints this calls do not exist yet — see
 * markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this UI was
 * built against.
 */
export default function MatchWeightDefaultsSettings() {
  const [weights, setWeights] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage({ text: "", error: false });
    adminAPI.getMatchWeightDefaults()
      .then((res) => {
        if (cancelled) return;
        setWeights(res.data?.weights || CODE_FALLBACK_WEIGHTS);
        setBounds(res.data?.bounds || null);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage({
          text: err.response?.status === 404
            ? "Not available yet — this feature's backend is still being built."
            : err.response?.data?.message || "Failed to load the platform default weights.",
          error: true,
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (newWeights) => {
    setSaving(true);
    setMessage({ text: "", error: false });
    try {
      const res = await adminAPI.updateMatchWeightDefaults({ weights: newWeights });
      setWeights(res.data?.weights || newWeights);
      setMessage({ text: "Platform default weights saved.", error: false });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || "Failed to save.", error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-panel-card admin-panel-card--wide">
      <div className="admin-card-header">
        <h3><FaSlidersH /> Platform Matching Defaults</h3>
      </div>
      <p className="admin-card-subtext">
        The job-matching weights every employer starts with, and what "Reset to platform
        default" on their own settings restores. Must sum to 100%.
      </p>

      {message.text && (
        <p className={message.error ? "admin-card-message admin-card-message--error" : "admin-card-message"} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {loading && !loaded ? (
        <p className="loading">Loading...</p>
      ) : loaded ? (
        <MatchWeightsEditor
          initialWeights={weights}
          bounds={bounds}
          onSave={handleSave}
          busy={saving}
        />
      ) : null}
    </section>
  );
}
