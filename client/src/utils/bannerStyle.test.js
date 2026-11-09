import test from "node:test";
import assert from "node:assert/strict";
import { CLASSIC_DEFINITION, bannerStyle, colorValue } from "./bannerStyle.js";

test("classic definition reproduces today's gradient and dots exactly", () => {
  const out = bannerStyle(CLASSIC_DEFINITION);
  assert.equal(out.background, "linear-gradient(160deg, var(--ds-green) 0%, var(--ds-green-deep) 100%)");
  assert.equal(out.pattern.backgroundImage, "radial-gradient(color-mix(in srgb, var(--ds-gold) 55%, transparent) 1.5px, transparent 1.75px)");
  assert.equal(out.pattern.backgroundSize, "22px 22px");
  assert.equal(out.pattern.opacity, 0.55);
  assert.equal(out.pattern.maskImage, "linear-gradient(90deg, transparent 0%, #000 55%)");
});

test("tokens become var() and hex stays; anything else is refused", () => {
  assert.equal(colorValue("ds-gold"), "var(--ds-gold)");
  assert.equal(colorValue("#0b704b"), "#0b704b");
  assert.equal(colorValue("url(http://x/y.png)"), null);
  assert.equal(colorValue("red"), null);
  assert.equal(colorValue("#fff"), null);
  assert.equal(colorValue(undefined), null);
});

test("a definition with bad colors falls back to the classic gradient, never to raw CSS", () => {
  const out = bannerStyle({ gradient: { angle: 10, stops: [{ color: "url(x)", at: 0 }, { color: "expression(1)", at: 100 }] } });
  assert.equal(out.background, bannerStyle(CLASSIC_DEFINITION).background);
  assert.ok(!out.background.includes("url("));
});

test("numbers are clamped", () => {
  const out = bannerStyle({
    gradient: { angle: 999, stops: [{ color: "ds-green", at: -5 }, { color: "ds-mint", at: 500 }] },
    pattern: { type: "grid", color: "ds-ink-500", mixPercent: 900, size: 1, opacity: 9, fade: "nope" },
  });
  assert.equal(out.background, "linear-gradient(360deg, var(--ds-green) 0%, var(--ds-mint) 100%)");
  assert.equal(out.pattern.backgroundSize, "8px 8px");
  assert.equal(out.pattern.opacity, 1);
  assert.equal(out.pattern.maskImage, "none");
  assert.ok(out.pattern.backgroundImage.includes("100%"));
});

test("pattern none or unknown gives no pattern layer", () => {
  assert.equal(bannerStyle({ gradient: CLASSIC_DEFINITION.gradient, pattern: { type: "none" } }).pattern, null);
  assert.equal(bannerStyle({ gradient: CLASSIC_DEFINITION.gradient, pattern: { type: "image", color: "ds-gold" } }).pattern, null);
  assert.equal(bannerStyle({ gradient: CLASSIC_DEFINITION.gradient }).pattern, null);
});

test("each pattern type produces its own layer", () => {
  for (const type of ["dots", "rings", "grid", "stripes"]) {
    const out = bannerStyle({ gradient: CLASSIC_DEFINITION.gradient, pattern: { type, color: "ds-gold", mixPercent: 50, size: 30, opacity: 0.3, fade: "center" } });
    assert.ok(out.pattern.backgroundImage.includes("gradient"), type);
  }
});

test("no definition at all renders the classic look", () => {
  assert.equal(bannerStyle(null).background, bannerStyle(CLASSIC_DEFINITION).background);
});
