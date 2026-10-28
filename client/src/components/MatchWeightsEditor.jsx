import { useState } from "react";
import {
  DIMENSION_ORDER,
  DIMENSION_LABELS,
  CODE_FALLBACK_WEIGHTS,
  PESO_RECOMMENDED_PRESET,
} from "../utils/qualifications";
import "../styles/match-weights-editor.css";

/**
 * Shared ten-slider job-matching weight editor (§C.1) — used by the
 * employer's "Matching Preferences" tab, the per-vacancy override panel on
 * the job posting form, and the admin platform-default panel. Each surface
 * owns its own fetch/save; this component is purely the editing UI plus the
 * sum-to-100 validation every surface needs identically.
 *
 * NOTE: the server endpoints this calls out to (via each surface's onSave/
 * onReset) do not exist yet as of this component's authoring — see
 * markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the exact contract this UI
 * was built against. Until that ships, Save/Reset will surface a network
 * error from the parent's onSave/onReset handler; the editing UI itself
 * (sliders, running total, presets) works fully offline.
 *
 * props:
 *   initialWeights  WeightsMap (10 keys, integers 0-100) to start the draft
 *                   from — e.g. the employer's saved profile, or the
 *                   platform default when they have none yet.
 *   bounds          BoundsMap (10 keys, {min,max}) clamping each slider, or
 *                   null while still loading (sliders fall back to 0-100).
 *   onSave          async (weights) => void. Only called when the draft
 *                   sums to exactly 100.
 *   onReset         async () => void, or omit to hide the reset button
 *                   entirely (the platform-default panel has nothing to
 *                   reset to).
 *   resetLabel      text for the reset button.
 *   busy            disables every control while a save/reset is in flight.
 *   showPreset      hide the "PESO recommended" preset button where it
 *                   doesn't make sense (e.g. the bounds editor, which isn't
 *                   a weights editor at all and doesn't use this component).
 */
export default function MatchWeightsEditor({
  initialWeights,
  bounds,
  onSave,
  onReset,
  resetLabel = "Reset to platform default",
  busy = false,
  showPreset = true,
}) {
  const [draft, setDraft] = useState(() => ({ ...CODE_FALLBACK_WEIGHTS, ...initialWeights }));

  // A new initialWeights reference (the fetch resolving, or the parent
  // switching which job's override is being edited) means a fresh edit
  // session — the draft is reseeded outright, not merged with whatever was
  // on screen before. Done during render (React's documented pattern for
  // "adjusting state when a prop changes"), not in an effect: an effect
  // here would commit the stale draft for one extra paint before correcting
  // itself on the next render.
  const [seededFrom, setSeededFrom] = useState(initialWeights);
  if (initialWeights !== seededFrom) {
    setSeededFrom(initialWeights);
    setDraft({ ...CODE_FALLBACK_WEIGHTS, ...initialWeights });
  }

  const setValue = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const applyPreset = () => setDraft({ ...PESO_RECOMMENDED_PRESET });

  // Bounds can load (or tighten) after a value was already set — clamp for
  // *display* (and for what Save actually sends) rather than writing the
  // correction back into `draft` via a second state update. Everything
  // downstream (the total, each slider, the saved payload) reads from this
  // single clamped view, so what the user sees is always what gets summed
  // and saved. Self-corrects the moment the user touches that slider either
  // way, and the server re-validates bounds independently regardless.
  const clamp = (value, b) => Math.min(b.max, Math.max(b.min, value));
  const displayWeights = {};
  DIMENSION_ORDER.forEach((key) => {
    const b = bounds?.[key] || { min: 0, max: 100 };
    displayWeights[key] = clamp(Number(draft[key]) || 0, b);
  });
  const total = DIMENSION_ORDER.reduce((sum, key) => sum + displayWeights[key], 0);
  const isValid = total === 100;

  return (
    <div className="match-weights-editor">
      <div className="mwe-rows">
        {DIMENSION_ORDER.map((key) => {
          const b = bounds?.[key] || { min: 0, max: 100 };
          return (
            <div className="mwe-row" key={key}>
              <span className="mwe-label">{DIMENSION_LABELS[key]}</span>
              <input
                type="range"
                className="mwe-slider"
                min={b.min}
                max={b.max}
                value={displayWeights[key]}
                disabled={busy}
                onChange={(e) => setValue(key, Number(e.target.value))}
                aria-label={`${DIMENSION_LABELS[key]} weight`}
                title={bounds ? `Allowed range: ${b.min}%–${b.max}%` : undefined}
              />
              <span className="mwe-value">{displayWeights[key]}%</span>
            </div>
          );
        })}
      </div>

      <div className={`mwe-total ${isValid ? "is-valid" : "is-invalid"}`}>
        Total: {total}% {isValid ? "✓" : "— must equal 100% to save"}
      </div>

      <div className="mwe-actions">
        {showPreset && (
          <button
            type="button"
            className="mwe-btn mwe-btn--ghost"
            onClick={applyPreset}
            disabled={busy}
            title="Skills 35% · Education 20% · Experience 20% · Location 15% · Certifications 10% — the other five dimensions are set to 0%"
          >
            Load PESO-recommended preset
          </button>
        )}
        {onReset && (
          <button
            type="button"
            className="mwe-btn mwe-btn--ghost"
            onClick={onReset}
            disabled={busy}
          >
            {resetLabel}
          </button>
        )}
        <button
          type="button"
          className="mwe-btn mwe-btn--primary"
          onClick={() => onSave(displayWeights)}
          disabled={!isValid || busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
