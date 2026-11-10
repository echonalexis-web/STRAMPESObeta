import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  PROFILE_TABS,
  buildBuiltInManifest,
  builtInStatus,
  manifestPayload,
  parseBuiltInFileName,
  searchForTab,
  tabForKey,
  tabFromSearch,
} from "./builtInTemplates.js";
import { AVATAR_LIMITS, TEMPLATE_LIMITS, checkTemplateDimensions, checkTemplateFile, errorField, isNearTargetRatio, limitsFor } from "./bannerTemplateFile.js";

const names = JSON.parse(readFileSync(new URL("../data/builtInTemplateNames.json", import.meta.url), "utf8"));
const assetDir = (dir) => new URL(`../assets/${dir}/`, import.meta.url);
const files = (dir, prefix) => readdirSync(assetDir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith(".svg"));

test("parseBuiltInFileName reads the number, key and fallback name", () => {
  assert.deepEqual(parseBuiltInFileName("banner", "../assets/cover-images/Banner_01_Forest_Dots.svg"), {
    number: "01",
    order: 1,
    key: "builtin-banner-01",
    fallbackName: "Forest Dots",
  });
  assert.equal(parseBuiltInFileName("avatar", "Avatar_12_Crescent_Star.svg").key, "builtin-avatar-12");
  assert.equal(parseBuiltInFileName("avatar", "Avatar_12_Crescent_Star.png"), null);
  assert.equal(parseBuiltInFileName("banner", "Avatar_01_X.svg"), null);
  assert.equal(parseBuiltInFileName("nope", "Banner_01_X.svg"), null);
  assert.equal(parseBuiltInFileName("banner", ""), null);
});

test("the real bundled folders map to 12 banners and 12 avatars with stable, unique keys", () => {
  for (const [kind, dir, prefix] of [["banner", "cover-images", "Banner_"], ["avatar", "avatars", "Avatar_"]]) {
    const manifest = buildBuiltInManifest(kind, files(dir, prefix), names);
    assert.equal(manifest.length, 12, kind);
    assert.equal(new Set(manifest.map((m) => m.key)).size, 12);
    assert.deepEqual(manifest.map((m) => m.key), Array.from({ length: 12 }, (_, i) => `builtin-${kind}-${String(i + 1).padStart(2, "0")}`));
    for (const entry of manifest) {
      assert.ok(entry.name && entry.nameFil, `${entry.key} has both names`);
      assert.ok(entry.name.length <= 60 && entry.nameFil.length <= 60);
    }
  }
});

test("english names agree with the file names", () => {
  for (const [kind, dir, prefix] of [["banner", "cover-images", "Banner_"], ["avatar", "avatars", "Avatar_"]]) {
    for (const file of files(dir, prefix)) {
      const info = parseBuiltInFileName(kind, file);
      assert.equal(names[kind][info.number].name, info.fallbackName, file);
    }
  }
});

test("only the first banner asks to be the default; avatars never do", () => {
  const banners = buildBuiltInManifest("banner", files("cover-images", "Banner_"), names);
  assert.deepEqual(banners.map((m) => m.isDefault), [true, ...Array(11).fill(false)]);
  assert.equal(banners[0].name, "Forest Dots");
  assert.ok(buildBuiltInManifest("avatar", files("avatars", "Avatar_"), names).every((m) => m.isDefault === false));
});

test("the manifest sorts by number, skips other files and falls back to the file name", () => {
  const manifest = buildBuiltInManifest("banner", ["x/Banner_02_B_Name.svg", "x/readme.txt", "x/Banner_01_A_Name.svg"], {});
  assert.deepEqual(manifest.map((m) => [m.key, m.name, m.nameFil]), [
    ["builtin-banner-01", "A Name", ""],
    ["builtin-banner-02", "B Name", ""],
  ]);
  assert.deepEqual(buildBuiltInManifest("banner", [], names), []);
});

test("manifestPayload sends only what the server reads", () => {
  const payload = manifestPayload([{ key: "builtin-banner-01", name: "A", nameFil: "B", isDefault: true, path: "secret/path.svg" }]);
  assert.deepEqual(payload, [{ key: "builtin-banner-01", name: "A", nameFil: "B", isDefault: true }]);
});

test("builtInStatus counts the built-ins that are present or missing", () => {
  const manifest = buildBuiltInManifest("banner", files("cover-images", "Banner_"), names);
  assert.deepEqual(builtInStatus(manifest, []), { total: 12, present: 0, missing: 12, none: true });
  const items = manifest.slice(0, 10).map((m) => ({ builtInKey: m.key })).concat([{ builtInKey: null }, { name: "custom" }]);
  assert.deepEqual(builtInStatus(manifest, items), { total: 12, present: 10, missing: 2, none: false });
  assert.deepEqual(builtInStatus(manifest, manifest.map((m) => ({ builtInKey: m.key }))), { total: 12, present: 12, missing: 0, none: false });
  assert.equal(builtInStatus([], null).none, true);
});

test("the tab is read from the URL and falls back to banners", () => {
  assert.equal(tabFromSearch("?tab=avatars"), "avatars");
  assert.equal(tabFromSearch("tab=banners"), "banners");
  assert.equal(tabFromSearch("?tab=evil"), "banners");
  assert.equal(tabFromSearch(""), "banners");
  assert.equal(tabFromSearch(undefined), "banners");
});

test("searchForTab sets the tab and keeps other parameters", () => {
  assert.equal(searchForTab("", "avatars"), "?tab=avatars");
  assert.equal(searchForTab("?tab=avatars&x=1", "banners"), "?tab=banners&x=1");
  assert.equal(searchForTab("?x=1", "nope"), "?x=1&tab=banners");
});

test("arrow keys move between the tabs and wrap; Home and End jump", () => {
  assert.deepEqual(PROFILE_TABS, ["banners", "avatars"]);
  assert.equal(tabForKey("banners", "ArrowRight"), "avatars");
  assert.equal(tabForKey("avatars", "ArrowRight"), "banners");
  assert.equal(tabForKey("banners", "ArrowLeft"), "avatars");
  assert.equal(tabForKey("avatars", "Home"), "banners");
  assert.equal(tabForKey("banners", "End"), "avatars");
  assert.equal(tabForKey("banners", "Enter"), null);
  assert.equal(tabForKey("nope", "ArrowRight"), null);
});

test("avatar files are checked against the avatar limits and codes", () => {
  assert.equal(limitsFor("avatar"), AVATAR_LIMITS);
  assert.equal(limitsFor("banner"), TEMPLATE_LIMITS);
  const png = { name: "a.png", type: "image/png", size: 1000 };
  assert.equal(checkTemplateFile(png, "png", AVATAR_LIMITS), null);
  assert.equal(checkTemplateFile({ ...png, size: AVATAR_LIMITS.maxBytes + 1 }, "png", AVATAR_LIMITS), "AVATAR_IMAGE_TOO_LARGE");
  assert.equal(checkTemplateFile({ ...png, name: "a.svg" }, "png", AVATAR_LIMITS), "AVATAR_IMAGE_TYPE");
  assert.equal(checkTemplateFile(png, null, AVATAR_LIMITS), "AVATAR_IMAGE_TYPE");
  assert.equal(isNearTargetRatio(512, 512, AVATAR_LIMITS), true);
  assert.equal(isNearTargetRatio(512, 400, AVATAR_LIMITS), false);
  assert.equal(checkTemplateDimensions("png", { width: 600, height: 600 }, AVATAR_LIMITS), null);
  assert.equal(checkTemplateDimensions("png", { width: 64, height: 64 }, AVATAR_LIMITS), "AVATAR_IMAGE_DIMENSIONS");
  assert.equal(checkTemplateDimensions("png", { width: 1600, height: 400 }, AVATAR_LIMITS), "AVATAR_IMAGE_RATIO");
  assert.equal(checkTemplateDimensions("svg", { width: 500, height: 500 }, AVATAR_LIMITS), null);
  assert.equal(checkTemplateDimensions("svg", { width: 1920, height: 480 }, TEMPLATE_LIMITS), null);
});

test("avatar error codes go to the image field", () => {
  assert.equal(errorField("AVATAR_IMAGE_RATIO"), "image");
  assert.equal(errorField("AVATAR_IMAGE_UNSAFE"), "image");
  assert.equal(errorField("AVATAR_UPLOAD_FAILED"), "image");
  assert.equal(errorField("TEMPLATE_NAME_TAKEN"), "name");
});
