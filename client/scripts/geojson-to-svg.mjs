// One-off conversion: MARINDUQUE.geojson (lon/lat polygons, one Feature per
// municipality landmass/island) -> SVG path data for the About page map.
// Not part of the app build — run manually with `node scripts/geojson-to-svg.mjs`.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const geojson = JSON.parse(readFileSync(path.join(__dirname, "../src/data/MARINDUQUE.geojson"), "utf8"));

const VIEWBOX_SIZE = 420; // square viewBox, matches the current SVG's rough scale
const PADDING = 12;

// Collect every coordinate across all features to compute one shared
// bounding box, so all municipalities project onto the same scale/origin.
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const f of geojson.features) {
  for (const ring of f.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
}

const meanLat = (minLat + maxLat) / 2;
const cosCorrection = Math.cos((meanLat * Math.PI) / 180); // longitude degrees are "shorter" than latitude degrees away from the equator
const lonSpan = (maxLon - minLon) * cosCorrection;
const latSpan = maxLat - minLat;
const drawable = VIEWBOX_SIZE - PADDING * 2;
const scale = drawable / Math.max(lonSpan, latSpan);

// Center the shape within the square viewBox on whichever axis has slack.
const projectedWidth = lonSpan * scale;
const projectedHeight = latSpan * scale;
const xOffset = PADDING + (drawable - projectedWidth) / 2;
const yOffset = PADDING + (drawable - projectedHeight) / 2;

const project = ([lon, lat]) => {
  const x = (lon - minLon) * cosCorrection * scale + xOffset;
  const y = (maxLat - lat) * scale + yOffset; // flip: latitude increases northward, SVG y increases downward
  return [Number(x.toFixed(2)), Number(y.toFixed(2))];
};

const ringToPath = (ring) => {
  const points = ring.map(project);
  return `M${points[0][0]},${points[0][1]} ` + points.slice(1).map(([x, y]) => `L${x},${y}`).join(" ") + " Z";
};

// Group every Feature (a municipality can have several: mainland + islets)
// by its MUNICIPALI property, and also track the mainland ring's area (the
// largest ring) so we can compute a sensible label/pin position.
const byMunicipality = new Map();
const polygonArea = (ring) => {
  // Shoelace formula on projected points — good enough to tell "mainland" from "tiny islet".
  const pts = ring.map(project);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
};
const centroid = (ring) => {
  const pts = ring.map(project);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [Number(cx.toFixed(1)), Number(cy.toFixed(1))];
};

for (const f of geojson.features) {
  const name = f.properties.MUNICIPALI;
  if (!byMunicipality.has(name)) {
    byMunicipality.set(name, { properties: f.properties, pathParts: [], mainlandRing: null, mainlandArea: -1 });
  }
  const entry = byMunicipality.get(name);
  for (const ring of f.geometry.coordinates) {
    entry.pathParts.push(ringToPath(ring));
    const area = polygonArea(ring);
    if (area > entry.mainlandArea) {
      entry.mainlandArea = area;
      entry.mainlandRing = ring;
    }
  }
}

const result = {};
for (const [name, entry] of byMunicipality) {
  result[name] = {
    d: entry.pathParts.join(" "),
    labelPos: centroid(entry.mainlandRing),
    zipcode: entry.properties.ZIPCODE,
    barangays: entry.properties.BRGY,
    registeredVoters: entry.properties.REG_VOTERS,
    landAreaHectares: entry.properties.LAND_AREA2,
    incomeClass: entry.properties.INCOME_CLA,
    ruralUrban: entry.properties.RUR_URB,
  };
}

const outPath = path.join(__dirname, "../src/data/marinduqueMap.json");
writeFileSync(
  outPath,
  JSON.stringify({ viewBox: `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`, municipalities: result }, null, 2)
);

console.log(`Wrote ${Object.keys(result).length} municipalities to ${outPath}`);
for (const [name, entry] of Object.entries(result)) {
  console.log(`${name}: ${entry.d.length} chars, label at [${entry.labelPos}], zip ${entry.zipcode}, ${entry.barangays} brgys`);
}
