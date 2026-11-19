// One place that says which shape goes with which status, so every status badge
// in the system reads the same way and never relies on colour alone.
//   dot = active, diamond = suspended, square = deactivated,
//   hollow circle = deleted, cross = banned.
export const STATUS_SHAPES = Object.freeze({
  active: "dot",
  suspended: "diamond",
  deactivated: "square",
  deleted: "ring",
  banned: "cross",
});

export const statusShape = (state) => STATUS_SHAPES[state] || "dot";

// The class list for a badge (styles/status-badge.css).
export const statusBadgeClass = (state) => `sb sb--${STATUS_SHAPES[state] ? state : "active"} sb--${statusShape(state)}`;
