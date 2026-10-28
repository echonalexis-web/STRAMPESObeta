// Server-side mirror of client/src/utils/locationParser.js — same matching
// logic, same dataset, ported to CommonJS. See server/utils/age.js for the
// established client/server mirroring precedent this follows.
//
// Why this exists: `JobVacancy.location` is a single String, but it is not
// arbitrary text — LocationSelect.jsx builds it as
// `[barangay, city, province, region].filter(Boolean).join(", ")` (barangay
// is optional). This parser recovers the structured components from that
// string (or from a `{barangay, city/municipality, province, region}`
// object) by matching each comma-separated part against the official PH
// gazetteer below, regardless of which components are present or what order
// they're in. The matching engine's location scoring must compare *parsed
// components*, never the raw strings — two differently-formatted strings for
// the same municipality would otherwise never match.
const phData = require("../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json");

const regions = Object.values(phData).map((r) => r.region_name);

// Normalizes a single location-name fragment for comparison: strips a
// leading "Barangay/City/Municipality/Province/Region " label word (some
// stored values carry one), collapses whitespace, drops punctuation, and
// upper-cases. Two spellings of the same place (different casing, an extra
// "City of " prefix, stray punctuation) normalize to the same key.
function normalizeLocationKey(value = "") {
  return String(value)
    .trim()
    .replace(/^(barangay|city|municipality|province|region)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .toUpperCase();
}

function findMatchingLocationName(candidates, target) {
  if (!target) return "";
  const normalizedTarget = normalizeLocationKey(target);
  return candidates.find((candidate) => normalizeLocationKey(candidate) === normalizedTarget) || "";
}

// Returns `{ barangay, city, province, region }` — each the ORIGINAL
// (as-given) spelling of whichever input part matched, or "" when that
// component couldn't be identified. `value` may be a comma-separated string
// ("BOAC, MARINDUQUE, REGION IV-B") or an object
// (`{barangay, city|municipality, province, region}`).
function parseLocationValue(value) {
  if (!value) return { barangay: "", city: "", province: "", region: "" };

  const objectValue = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const parts = objectValue
    ? [
        objectValue.barangay,
        objectValue.municipality || objectValue.city,
        objectValue.province,
        objectValue.region,
      ].filter((part) => typeof part === "string" && part.trim())
    : String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

  if (!parts.length) return { barangay: "", city: "", province: "", region: "" };

  const regionNames = regions;
  const provinceNames = Object.values(phData).flatMap((region) => Object.keys(region.province_list || {}));

  const regionMatch = parts.find((part) =>
    regionNames.some((regionName) => normalizeLocationKey(regionName) === normalizeLocationKey(part))
  );

  const provinceMatch = parts.find((part) =>
    provinceNames.some((provinceName) => normalizeLocationKey(provinceName) === normalizeLocationKey(part))
  );

  const selectedRegion = regionMatch
    ? Object.values(phData).find((region) => normalizeLocationKey(region.region_name) === normalizeLocationKey(regionMatch))
    : Object.values(phData).find((region) => region.province_list && Object.keys(region.province_list).some((provinceName) => normalizeLocationKey(provinceName) === normalizeLocationKey(provinceMatch || "")));

  const municipalityNames = selectedRegion
    ? Object.entries(selectedRegion.province_list || {}).flatMap(([provinceName, provinceData]) =>
        provinceMatch && normalizeLocationKey(provinceName) === normalizeLocationKey(provinceMatch)
          ? Object.keys(provinceData.municipality_list || {})
          : []
      )
    : [];

  const cityMatch = parts.find((part) =>
    municipalityNames.some((municipalityName) => normalizeLocationKey(municipalityName) === normalizeLocationKey(part))
  );

  const matchingProvince = provinceMatch || findMatchingLocationName(Object.keys(selectedRegion?.province_list || {}), parts[parts.length - 2] || "");
  const matchingCity = cityMatch || findMatchingLocationName(municipalityNames, parts[parts.length - 3] || "");

  const selectedProvince = selectedRegion?.province_list[matchingProvince] || selectedRegion?.province_list[provinceMatch];
  const barangayNames = selectedProvince && matchingCity
    ? selectedProvince.municipality_list?.[matchingCity]?.barangay_list || []
    : [];

  const barangayMatch = parts.find((part) =>
    barangayNames.some((barangayName) => normalizeLocationKey(barangayName) === normalizeLocationKey(part))
  );

  return {
    barangay: barangayMatch || "",
    city: matchingCity || cityMatch || "",
    province: matchingProvince || provinceMatch || "",
    region: regionMatch || "",
  };
}

module.exports = { regions, parseLocationValue, normalizeLocationKey };
