// Starter banner templates, built from design tokens only (no images).
// Pattern edges carry fades and texture; nothing important sits in the top or
// bottom quarter, because the banner crops to the center band (104px on phones,
// 216px on desktop). "classic-green" is exactly today's look and is the default.

const stops = (...pairs) => pairs.map(([color, at]) => ({ color, at }));
const dots = (color, extra = {}) => ({ type: "dots", color, mixPercent: 55, size: 22, opacity: 0.55, fade: "left", ...extra });

module.exports = [
  {
    slug: "classic-green",
    name: "Classic green",
    nameFil: "Klasikong berde",
    kind: "pattern",
    overlay: "dark",
    isDefault: true,
    definition: { gradient: { angle: 160, stops: stops(["ds-green", 0], ["ds-green-deep", 100]) }, pattern: dots("ds-gold") },
  },
  {
    slug: "gold-dots",
    name: "Gold dots",
    nameFil: "Gintong tuldok",
    kind: "pattern",
    overlay: "dark",
    definition: { gradient: { angle: 135, stops: stops(["ds-green-secondary", 0], ["ds-green", 100]) }, pattern: dots("ds-gold", { size: 28, opacity: 0.7, fade: "center" }) },
  },
  {
    slug: "cream-rings",
    name: "Cream rings",
    nameFil: "Krem na singsing",
    kind: "pattern",
    overlay: "light",
    definition: {
      gradient: { angle: 180, stops: stops(["ds-mint", 0], ["ds-ink-50", 100]) },
      pattern: { type: "rings", color: "ds-gold-deep", mixPercent: 40, size: 40, opacity: 0.35, fade: "right" },
    },
  },
  {
    slug: "forest-stripes",
    name: "Forest stripes",
    nameFil: "Guhit ng kagubatan",
    kind: "pattern",
    overlay: "dark",
    definition: {
      gradient: { angle: 90, stops: stops(["ds-green-deep", 0], ["ds-green", 100]) },
      pattern: { type: "stripes", color: "ds-mint", mixPercent: 30, size: 24, opacity: 0.18, fade: "none" },
    },
  },
  {
    slug: "mint-grid",
    name: "Mint grid",
    nameFil: "Mint na grid",
    kind: "pattern",
    overlay: "light",
    definition: {
      gradient: { angle: 160, stops: stops(["ds-mint", 0], ["ds-surface", 100]) },
      pattern: { type: "grid", color: "ds-green-secondary", mixPercent: 35, size: 32, opacity: 0.25, fade: "left" },
    },
  },
  {
    slug: "deep-green",
    name: "Deep green",
    nameFil: "Malalim na berde",
    kind: "gradient",
    overlay: "dark",
    definition: { gradient: { angle: 180, stops: stops(["ds-green-deep", 0], ["ds-green-deep", 100]) } },
  },
  {
    slug: "warm-sand",
    name: "Warm sand",
    nameFil: "Maiinit na buhangin",
    kind: "gradient",
    overlay: "light",
    definition: { gradient: { angle: 120, stops: stops(["#f3e3b0", 0], ["#e6b91e", 100]) } },
  },
  {
    slug: "slate",
    name: "Slate",
    nameFil: "Slate",
    kind: "gradient",
    overlay: "dark",
    definition: { gradient: { angle: 160, stops: stops(["ds-ink-700", 0], ["ds-ink-900", 100]) } },
  },
  {
    slug: "charcoal",
    name: "Charcoal",
    nameFil: "Uling",
    kind: "gradient",
    overlay: "dark",
    definition: { gradient: { angle: 200, stops: stops(["#2b2f2d", 0], ["#111413", 100]) } },
  },
  {
    slug: "sky",
    name: "Sky",
    nameFil: "Langit",
    kind: "gradient",
    overlay: "dark",
    definition: { gradient: { angle: 150, stops: stops(["#4a8fc4", 0], ["#1d5a8f", 100]) } },
  },
];
