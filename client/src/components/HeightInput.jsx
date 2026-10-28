import { useState } from "react";
import { cmToFeetInches, feetInchesToCm } from "../utils/unitConversion";

/**
 * Height field with an explicit cm / ft+in unit toggle (item 3 — modern
 * standard, replacing the old free-text-with-converted-hint pattern).
 * `value` is always canonical centimeters (string, same as before);
 * `onChange` is always called with the next canonical cm string. Which unit
 * is currently *displayed* is local, UI-only state — the feet/inches shown
 * are derived from `value` every render, never tracked separately, so there
 * is exactly one source of truth and no state-sync bugs.
 */
export default function HeightInput({ value, onChange, disabled }) {
  const [unit, setUnit] = useState("cm");

  const cm = value === "" || value === null || value === undefined ? null : Number(value);
  const { feet, inches } = cmToFeetInches(cm);

  const handleCmChange = (e) => {
    onChange(e.target.value);
  };

  const handleFeetChange = (e) => {
    onChange(String(feetInchesToCm(e.target.value, inches)));
  };

  const handleInchesChange = (e) => {
    onChange(String(feetInchesToCm(feet, e.target.value)));
  };

  return (
    <div className="unit-input">
      <div className="unit-toggle" role="group" aria-label="Height unit">
        <button
          type="button"
          className={`unit-toggle-btn ${unit === "cm" ? "active" : ""}`}
          onClick={() => setUnit("cm")}
          disabled={disabled}
        >
          cm
        </button>
        <button
          type="button"
          className={`unit-toggle-btn ${unit === "ftin" ? "active" : ""}`}
          onClick={() => setUnit("ftin")}
          disabled={disabled}
        >
          ft + in
        </button>
      </div>
      {unit === "cm" ? (
        <input
          type="number"
          inputMode="decimal"
          min="0"
          className="number-input"
          placeholder="e.g. 170"
          value={value ?? ""}
          onChange={handleCmChange}
          disabled={disabled}
          aria-label="Height in centimeters"
        />
      ) : (
        <div className="unit-input-pair">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            className="number-input"
            placeholder="Feet"
            value={cm === null ? "" : feet}
            onChange={handleFeetChange}
            disabled={disabled}
            aria-label="Height, feet"
          />
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="11.9"
            className="number-input"
            placeholder="Inches"
            value={cm === null ? "" : inches}
            onChange={handleInchesChange}
            disabled={disabled}
            aria-label="Height, inches"
          />
        </div>
      )}
    </div>
  );
}
