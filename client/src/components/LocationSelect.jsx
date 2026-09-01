import { useMemo } from "react";
import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";

const regions = Object.values(phData).map(r => r.region_name);

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

export default function LocationSelect({ value, onChange, disabled, required = false, className = "" }) {
  const parsed = useMemo(() => {
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
  }, [value]);

  const selectedRegion = Object.values(phData).find(r => r.region_name === parsed.region);
  const provinces = selectedRegion ? Object.keys(selectedRegion.province_list) : [];
  const selectedProvince = selectedRegion?.province_list[parsed.province];
  const municipalities = selectedProvince ? Object.keys(selectedProvince.municipality_list) : [];
  const selectedMunicipality = selectedProvince?.municipality_list[parsed.city];
  const barangays = selectedMunicipality ? selectedMunicipality.barangay_list : [];

  const buildAndEmit = (newRegion, newProvince, newCity, newBarangay) => {
    const parts = [newBarangay, newCity, newProvince, newRegion].filter(Boolean);
    const locationString = parts.join(", ");
    const structured = {
      region: newRegion || "",
      province: newProvince || "",
      city: newCity || "",
      barangay: newBarangay || "",
    };
    if (typeof onChange === "function") {
      onChange(locationString, structured);
    }
  };

  const handleRegionChange = (e) => {
    const r = e.target.value;
    buildAndEmit(r, "", "", "");
  };

  const handleProvinceChange = (e) => {
    const p = e.target.value;
    buildAndEmit(parsed.region, p, "", "");
  };

  const handleCityChange = (e) => {
    const c = e.target.value;
    buildAndEmit(parsed.region, parsed.province, c, "");
  };

  const handleBarangayChange = (e) => {
    const b = e.target.value;
    buildAndEmit(parsed.region, parsed.province, parsed.city, b);
  };

  return (
    <div className={`location-select ${className}`.trim()}>
      <div className="location-select-grid">
        <label>
          <span>Region {required && "*"}</span>
          <select value={parsed.region} onChange={handleRegionChange} required={required} disabled={disabled}>
            <option value="">-- Select Region --</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <label>
          <span>Province {required && "*"}</span>
          <select value={parsed.province} onChange={handleProvinceChange} required={required} disabled={!parsed.region || disabled}>
            <option value="">-- Select Province --</option>
            {provinces.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <div className="location-select-grid">
        <label>
          <span>City / Municipality {required && "*"}</span>
          <select value={parsed.city} onChange={handleCityChange} required={required} disabled={!parsed.province || disabled}>
            <option value="">-- Select City/Municipality --</option>
            {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        <label>
          <span>Barangay</span>
          <select value={parsed.barangay} onChange={handleBarangayChange} disabled={!parsed.city || disabled}>
            <option value="">-- Select Barangay --</option>
            {barangays.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}