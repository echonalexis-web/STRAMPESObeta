import { useMemo } from "react";
import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";

const regions = Object.values(phData).map(r => r.region_name);

export default function LocationSelect({ value, onChange, disabled, required = false }) {
  const parsed = useMemo(() => {
    if (!value) return { barangay: "", city: "", province: "", region: "" };
    const parts = value.split(", ");
    const len = parts.length;
    return {
      barangay: len >= 4 ? parts[0] : "",
      city: len >= 4 ? parts[1] : len === 3 ? parts[0] : "",
      province: len >= 4 ? parts[2] : len === 3 ? parts[1] : len === 2 ? parts[0] : "",
      region: len >= 4 ? parts[3] : len === 3 ? parts[2] : len === 2 ? parts[1] : parts[0] || "",
    };
  }, [value]);

  const selectedRegion = Object.values(phData).find(r => r.region_name === parsed.region);
  const provinces = selectedRegion ? Object.keys(selectedRegion.province_list) : [];
  const selectedProvince = selectedRegion?.province_list[parsed.province];
  const municipalities = selectedProvince ? Object.keys(selectedProvince.municipality_list) : [];
  const selectedMunicipality = selectedProvince?.municipality_list[parsed.city];
  const barangays = selectedMunicipality ? selectedMunicipality.barangay_list : [];

  const buildAndEmit = (newRegion, newProvince, newCity, newBarangay) => {
    // Always emit 4 parts (barangay, city, province, region)
    const parts = [newBarangay, newCity, newProvince, newRegion];
    onChange(parts.join(", "));
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
    <>
      <label>
        Region {required && "*"}
        <select value={parsed.region} onChange={handleRegionChange} required={required} disabled={disabled}>
          <option value="">-- Select Region --</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      <label>
        Province {required && "*"}
        <select value={parsed.province} onChange={handleProvinceChange} required={required} disabled={!parsed.region || disabled}>
          <option value="">-- Select Province --</option>
          {provinces.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <label>
        City / Municipality {required && "*"}
        <select value={parsed.city} onChange={handleCityChange} required={required} disabled={!parsed.province || disabled}>
          <option value="">-- Select City/Municipality --</option>
          {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <label>
        Barangay
        <select value={parsed.barangay} onChange={handleBarangayChange} disabled={!parsed.city || disabled}>
          <option value="">-- Select Barangay --</option>
          {barangays.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
    </>
  );
}