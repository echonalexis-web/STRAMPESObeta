import { useState } from "react";
import { kgToLb, lbToKg } from "../utils/unitConversion";

/**
 * Weight field with an explicit kg / lb unit toggle (item 3 — modern
 * standard, replacing the old free-text-with-converted-hint pattern).
 * `value` is always canonical kilograms (string, same as before); `onChange`
 * is always called with the next canonical kg string.
 *
 * Which unit is currently *displayed* ("kg" or "lb") is controlled via the
 * optional `unit`/`onUnitChange` props so a caller can persist it
 * (JobseekerProfile.weightUnit) and have the toggle round-trip on reload
 * instead of always resetting to kg. When the caller omits them, the toggle
 * falls back to local-only state, preserving the original uncontrolled
 * behavior. Either way the lb value shown is derived from `value` every
 * render, never tracked separately.
 */
export default function WeightInput({ value, onChange, unit: controlledUnit, onUnitChange, disabled }) {
  const [localUnit, setLocalUnit] = useState("kg");
  const unit = controlledUnit ?? localUnit;
  const setUnit = onUnitChange ?? setLocalUnit;

  const kg = value === "" || value === null || value === undefined ? null : Number(value);
  const lbDisplay = kg === null ? "" : kgToLb(kg);

  const handleKgChange = (e) => {
    onChange(e.target.value);
  };

  const handleLbChange = (e) => {
    const next = e.target.value;
    onChange(next === "" ? "" : String(lbToKg(next)));
  };

  return (
    <div className="unit-input">
      <div className="unit-toggle" role="group" aria-label="Weight unit">
        <button
          type="button"
          className={`unit-toggle-btn ${unit === "kg" ? "active" : ""}`}
          onClick={() => setUnit("kg")}
          disabled={disabled}
        >
          kg
        </button>
        <button
          type="button"
          className={`unit-toggle-btn ${unit === "lb" ? "active" : ""}`}
          onClick={() => setUnit("lb")}
          disabled={disabled}
        >
          lb
        </button>
      </div>
      {unit === "kg" ? (
        <input
          type="number"
          inputMode="decimal"
          min="0"
          className="number-input"
          placeholder="e.g. 65"
          value={value ?? ""}
          onChange={handleKgChange}
          disabled={disabled}
          aria-label="Weight in kilograms"
        />
      ) : (
        <input
          type="number"
          inputMode="decimal"
          min="0"
          className="number-input"
          placeholder="e.g. 143"
          value={lbDisplay}
          onChange={handleLbChange}
          disabled={disabled}
          aria-label="Weight in pounds"
        />
      )}
    </div>
  );
}
