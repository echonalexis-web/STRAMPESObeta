import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";

export const regions = Object.values(phData).map(r => r.region_name);

const normalizeLocationKey = (value = "") => String(value)
  .trim()
  .replace(/^(barangay|city|municipality|province|region)\s+/i, "")
  .replace(/\s+/g, " ")
  .replace(/[^\w\s-]/g, "")
  .toUpperCase();

const findMatchingLocationName = (candidates, target) => {
  if (!target) return "";
  const normalizedTarget = normalizeLocationKey(target);
  return candidates.find((candidate) => normalizeLocationKey(candidate) === normalizedTarget) || "";
};

export function parseLocationValue(value) {
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
