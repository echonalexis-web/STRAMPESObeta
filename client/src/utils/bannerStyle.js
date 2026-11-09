// Turns a validated banner template definition (server/services/bannerTemplateService.js)
// into inline style objects. The server only stores design-token names and
// #rrggbb colors, but this function re-checks every value so a bad document can
// never produce free CSS: anything not recognised falls back to the classic look.

const TOKENS = new Set([
  "ds-green-deep",
  "ds-green",
  "ds-green-secondary",
  "ds-mint",
  "ds-gold",
  "ds-gold-deep",
  "ds-ink-900",
  "ds-ink-700",
  "ds-ink-500",
  "ds-ink-300",
  "ds-ink-100",
  "ds-ink-50",
  "ds-bg",
  "ds-surface",
]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const PATTERNS = new Set(["dots", "rings", "grid", "stripes"]);

// Today's look, kept in step with the server's CLASSIC_DEFINITION.
export const CLASSIC_DEFINITION = Object.freeze({
  gradient: {
    angle: 160,
    stops: [
      { color: "ds-green", at: 0 },
      { color: "ds-green-deep", at: 100 },
    ],
  },
  pattern: { type: "dots", color: "ds-gold", mixPercent: 55, size: 22, opacity: 0.55, fade: "left" },
});

const num = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const colorValue = (color) => {
  if (typeof color === "string" && TOKENS.has(color)) return `var(--${color})`;
  if (typeof color === "string" && HEX.test(color)) return color;
  return null;
};

const FADE_MASKS = {
  left: "linear-gradient(90deg, transparent 0%, #000 55%)",
  right: "linear-gradient(270deg, transparent 0%, #000 55%)",
  center: "radial-gradient(ellipse at center, #000 20%, transparent 85%)",
};

const gradientCss = (gradient) => {
  const angle = num(gradient?.angle, 0, 360, 160);
  const stops = Array.isArray(gradient?.stops) ? gradient.stops.slice(0, 4) : [];
  const parts = stops
    .map((stop) => {
      const color = colorValue(stop?.color);
      return color ? `${color} ${num(stop?.at, 0, 100, 0)}%` : null;
    })
    .filter(Boolean);
  if (parts.length < 2) return gradientCss(CLASSIC_DEFINITION.gradient);
  return `linear-gradient(${angle}deg, ${parts.join(", ")})`;
};

const patternStyle = (pattern) => {
  if (!pattern || !PATTERNS.has(pattern.type)) return null;
  const base = colorValue(pattern.color);
  if (!base) return null;
  const size = num(pattern.size, 8, 80, 22);
  const tint = `color-mix(in srgb, ${base} ${num(pattern.mixPercent, 0, 100, 55)}%, transparent)`;
  const mask = FADE_MASKS[pattern.fade] || "none";

  let backgroundImage;
  if (pattern.type === "dots") {
    backgroundImage = `radial-gradient(${tint} 1.5px, transparent 1.75px)`;
  } else if (pattern.type === "rings") {
    backgroundImage = `radial-gradient(circle, transparent 38%, ${tint} 40%, ${tint} 44%, transparent 46%)`;
  } else if (pattern.type === "grid") {
    backgroundImage = `linear-gradient(${tint} 1px, transparent 1px), linear-gradient(90deg, ${tint} 1px, transparent 1px)`;
  } else {
    backgroundImage = `repeating-linear-gradient(45deg, ${tint} 0, ${tint} 2px, transparent 2px, transparent ${size}px)`;
  }
  return {
    backgroundImage,
    backgroundSize: `${size}px ${size}px`,
    opacity: num(pattern.opacity, 0, 1, 0.55),
    WebkitMaskImage: mask,
    maskImage: mask,
  };
};

// { background, pattern } : `background` goes on the banner box, `pattern` (or
// null) on the decorative layer above it.
export const bannerStyle = (definition) => {
  const def = definition && typeof definition === "object" ? definition : CLASSIC_DEFINITION;
  return { background: gradientCss(def.gradient), pattern: patternStyle(def.pattern) };
};
