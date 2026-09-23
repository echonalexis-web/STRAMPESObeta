import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";

export const ALL_LOCATIONS = Object.values(phData).flatMap((region) =>
  Object.entries(region.province_list || {}).flatMap(([provinceName, provinceData]) =>
    Object.keys(provinceData.municipality_list || {}).map((municipality) => `${municipality}, ${provinceName}`)
  )
);

// Built lazily (and only once) since it holds one entry per barangay
// nationwide (~42k) — too many to eagerly flatten at module load or to
// re-filter with a fresh array allocation on every keystroke.
let flatBarangayLocations = null;
const getFlatBarangayLocations = () => {
  if (flatBarangayLocations) return flatBarangayLocations;
  flatBarangayLocations = Object.values(phData).flatMap((region) =>
    Object.entries(region.province_list || {}).flatMap(([provinceName, provinceData]) =>
      Object.entries(provinceData.municipality_list || {}).flatMap(([municipality, municipalityData]) =>
        (municipalityData.barangay_list || []).map(
          (barangay) => `${barangay}, ${municipality}, ${provinceName}`
        )
      )
    )
  );
  return flatBarangayLocations;
};

/**
 * Barangay-to-province autosuggest: returns up to `limit` "Barangay, City/
 * Municipality, Province" strings whose text includes `query`. Empty below
 * two characters so the full nationwide list is never rendered at once.
 */
export const searchBarangayLocations = (query, limit = 20) => {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const all = getFlatBarangayLocations();
  const results = [];
  for (let i = 0; i < all.length && results.length < limit; i++) {
    if (all[i].toLowerCase().includes(q)) results.push(all[i]);
  }
  return results;
};
