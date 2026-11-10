import { test } from "node:test";
import assert from "node:assert/strict";
import { initialOf, pickAvatarSource, presetImageUrl } from "./avatarSource.js";

test("initialOf takes the first letter, upper case, with a fallback", () => {
  assert.equal(initialOf("juan dela Cruz"), "J");
  assert.equal(initialOf("  ana"), "A");
  assert.equal(initialOf(""), "U");
  assert.equal(initialOf(null, "C"), "C");
});

test("a chosen preset wins over the uploaded photo", () => {
  assert.deepEqual(pickAvatarSource({ presetUrl: "/p.webp", photoUrl: "/me.jpg" }), { kind: "preset", url: "/p.webp" });
});

test("with no preset the photo shows, with neither the initials show", () => {
  assert.deepEqual(pickAvatarSource({ photoUrl: "/me.jpg" }), { kind: "photo", url: "/me.jpg" });
  assert.deepEqual(pickAvatarSource({}), { kind: "initials", url: "" });
  assert.deepEqual(pickAvatarSource(), { kind: "initials", url: "" });
});

test("a source that failed to load is skipped, falling back step by step", () => {
  const sources = { presetUrl: "/p.webp", photoUrl: "/me.jpg" };
  assert.deepEqual(pickAvatarSource(sources, new Set(["/p.webp"])), { kind: "photo", url: "/me.jpg" });
  assert.deepEqual(pickAvatarSource(sources, new Set(["/p.webp", "/me.jpg"])), { kind: "initials", url: "" });
  assert.deepEqual(pickAvatarSource({ presetUrl: "/p.webp" }, new Set(["/p.webp"])), { kind: "initials", url: "" });
});

test("presetImageUrl uses the thumbnail for small sizes and the full image for large", () => {
  const preset = { image: { url: "/big.webp", thumbUrl: "/small.webp" } };
  assert.equal(presetImageUrl(preset, 40), "/small.webp");
  assert.equal(presetImageUrl(preset, 96), "/small.webp");
  assert.equal(presetImageUrl(preset, 128), "/big.webp");
  assert.equal(presetImageUrl(preset, "fill"), "/small.webp");
  assert.equal(presetImageUrl({ image: { url: "/only.webp" } }, 40), "/only.webp");
  assert.equal(presetImageUrl(null, 40), "");
  assert.equal(presetImageUrl({}, 40, (v) => `X${v}`), "");
  assert.equal(presetImageUrl(preset, 40, (v) => `https://cdn${v}`), "https://cdn/small.webp");
});
