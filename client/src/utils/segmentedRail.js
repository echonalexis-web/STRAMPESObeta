// Logic for the shared segmented pill rail (hooks/useSegmentedRail.js). Pure, so it can be
// tested without a browser.

// Where each visible pill sits in the rail: "first", "middle", "last", or "single" when the
// rail has one pill. The rail's CSS shapes the ends from these (data-seg-pos).
export const segmentPositions = (count) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return [];
  if (n === 1) return ["single"];
  return Array.from({ length: n }, (_, index) => (index === 0 ? "first" : index === n - 1 ? "last" : "middle"));
};

// Does the joined (edge to edge, never wrapping) rail fit on one row? It must not scroll
// itself and must not be wider than the box that holds it. Sub-pixel rounding is ignored.
export const railFits = ({ scrollWidth = 0, clientWidth = 0, parentWidth = 0 } = {}) => {
  const slack = 1;
  const roomInParent = parentWidth > 0 ? scrollWidth <= parentWidth + slack : true;
  return scrollWidth <= clientWidth + slack && roomInParent;
};

// The segmented shape only applies from this width up; below it every rail keeps its own
// separate pills exactly as before. Keep in sync with the media query in segmented-rail.css.
export const SEGMENTED_MIN_WIDTH = 769;
