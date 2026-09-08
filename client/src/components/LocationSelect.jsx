import { useMemo } from "react";
import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";
import { regions, parseLocationValue } from "../utils/locationParser";

export default function LocationSelect({ value, onChange, disabled, required = false, className = "" }) {
  const parsed = useMemo(() => parseLocationValue(value), [value]);

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
