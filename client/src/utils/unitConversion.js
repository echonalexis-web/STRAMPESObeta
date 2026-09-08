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
