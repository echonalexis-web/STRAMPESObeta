// Accepts plain cm ("170") or feet/inches ("5'8\"", "5'8", "5ft 8in") and returns cm.
export function parseHeightToCm(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const feetInchMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|’|ft\.?|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|”|in\.?|inch(?:es)?)?\s*$/i);
  if (feetInchMatch) {
    const feet = parseFloat(feetInchMatch[1]) || 0;
    const inches = parseFloat(feetInchMatch[2]) || 0;
    return Math.round((feet * 30.48 + inches * 2.54) * 10) / 10;
  }

  const plain = parseFloat(s);
  return Number.isNaN(plain) ? null : plain;
}

// Accepts plain kg ("65") or pounds ("143lbs", "143 lb", "143 pounds") and returns kg.
export function parseWeightToKg(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const lbMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:lbs?\.?|pounds?)$/i);
  if (lbMatch) {
    const lb = parseFloat(lbMatch[1]);
    return Math.round((lb / 2.20462) * 10) / 10;
  }

  const plain = parseFloat(s);
  return Number.isNaN(plain) ? null : plain;
}

// True when parsing did real unit conversion (feet/inches or lbs), not just a bare number.
export function wasConverted(raw, parsedValue) {
  if (parsedValue === null) return false;
  const bareNumber = parseFloat(String(raw ?? "").trim());
  return bareNumber !== parsedValue;
}

// Reverse conversions for the unit-toggle inputs (HeightInput.jsx / WeightInput.jsx) — these
// derive a display value from the canonical stored value, the opposite direction of the parsers
// above (which turn free-typed text back into the canonical unit).
export function cmToFeetInches(cm) {
  if (!Number.isFinite(cm) || cm < 0) return { feet: "", inches: "" };
  const totalInches = cm / 2.54;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 10) / 10;
  // Rounding inches up to 12 (e.g. 5'12") should carry into the next foot.
  if (inches >= 12) {
    feet += 1;
    inches -= 12;
  }
  return { feet: String(feet), inches: String(inches) };
}

export function feetInchesToCm(feet, inches) {
  const f = parseFloat(feet) || 0;
  const i = parseFloat(inches) || 0;
  return Math.round((f * 30.48 + i * 2.54) * 10) / 10;
}

export function kgToLb(kg) {
  if (!Number.isFinite(kg) || kg < 0) return "";
  return String(Math.round(kg * 2.20462 * 10) / 10);
}

export function lbToKg(lb) {
  const n = parseFloat(lb) || 0;
  return Math.round((n / 2.20462) * 10) / 10;
}
