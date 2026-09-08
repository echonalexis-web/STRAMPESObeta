import phData from "../data/philippine_provinces_cities_municipalities_and_barangays_2019v2.json";

export const ALL_LOCATIONS = Object.values(phData).flatMap((region) =>
  Object.entries(region.province_list || {}).flatMap(([provinceName, provinceData]) =>
    Object.keys(provinceData.municipality_list || {}).map((municipality) => `${municipality}, ${provinceName}`)
  )
);
