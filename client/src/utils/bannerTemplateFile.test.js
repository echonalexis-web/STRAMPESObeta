import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkTemplateDimensions,
  checkTemplateFile,
  errorField,
  formatBytes,
  isNearTargetRatio,
  matchesFilter,
  matchesQuery,
  sniffImageType,
  svgDimensions,
  TEMPLATE_LIMITS,
} from "./bannerTemplateFile.js";

const bytes = (text) => new TextEncoder().encode(text);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("sniffImageType reads the content, not a name", () => {
  assert.equal(sniffImageType(PNG), "png");
  assert.equal(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1"/>')), "svg");
  assert.equal(sniffImageType(bytes('<?xml version="1.0"?>\n<!-- c --><svg viewBox="0 0 4 1"/>')), "svg");
  assert.equal(sniffImageType(bytes('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="x"/>')), "svg");
  assert.equal(sniffImageType(bytes("<!doctype html><html><script>alert(1)</script>")), null);
  assert.equal(sniffImageType(bytes("alert(1);//padding padding")), null);
  assert.equal(sniffImageType(new Uint8Array(3)), null);
  assert.equal(sniffImageType(null), null);
});

test("checkTemplateFile needs the name, MIME type and content to agree", () => {
  const ok = { name: "a.png", type: "image/png", size: 1000 };
  assert.equal(checkTemplateFile(ok, "png"), null);
  assert.equal(checkTemplateFile({ name: "a.svg", type: "image/svg+xml", size: 1000 }, "svg"), null);
  assert.equal(checkTemplateFile({ ...ok, name: "a.svg" }, "png"), "TEMPLATE_IMAGE_TYPE"); // a PNG named .svg
  assert.equal(checkTemplateFile({ name: "a.png", type: "image/png", size: 10 }, "svg"), "TEMPLATE_IMAGE_TYPE"); // an SVG named .png
  assert.equal(checkTemplateFile({ ...ok, type: "image/jpeg" }, "png"), "TEMPLATE_IMAGE_TYPE");
  assert.equal(checkTemplateFile(ok, null), "TEMPLATE_IMAGE_TYPE"); // HTML renamed .png
});

test("checkTemplateFile applies the PNG and the smaller SVG size caps", () => {
  assert.equal(checkTemplateFile({ name: "a.png", type: "image/png", size: TEMPLATE_LIMITS.maxBytes }, "png"), null);
  assert.equal(checkTemplateFile({ name: "a.png", type: "image/png", size: TEMPLATE_LIMITS.maxBytes + 1 }, "png"), "TEMPLATE_IMAGE_TOO_LARGE");
  assert.equal(checkTemplateFile({ name: "a.svg", type: "image/svg+xml", size: TEMPLATE_LIMITS.maxSvgBytes + 1 }, "svg"), "TEMPLATE_IMAGE_TOO_LARGE");
  assert.equal(checkTemplateFile({ name: "a.png", type: "image/png", size: 0 }, "png"), "TEMPLATE_IMAGE_TOO_LARGE");
});

test("isNearTargetRatio accepts about 4:1 within the tolerance", () => {
  assert.equal(isNearTargetRatio(1600, 400), true);
  assert.equal(isNearTargetRatio(1600, 410), true);
  assert.equal(isNearTargetRatio(1600, 440), false);
  assert.equal(isNearTargetRatio(1600, 800), false);
  assert.equal(isNearTargetRatio(0, 400), false);
  assert.equal(isNearTargetRatio(NaN, 400), false);
});

test("svgDimensions reads width and height, then the viewBox", () => {
  assert.deepEqual(svgDimensions('<svg xmlns="x" width="1600" height="400">'), { width: 1600, height: 400 });
  assert.deepEqual(svgDimensions('<svg width="1600px" height="400px">'), { width: 1600, height: 400 });
  assert.deepEqual(svgDimensions('<svg viewBox="0 0 1600 400">'), { width: 1600, height: 400 });
  assert.deepEqual(svgDimensions('<svg width="100%" height="100%" viewBox="0 0 800 200">'), { width: 800, height: 200 });
  assert.equal(svgDimensions('<svg width="100%" height="100%">'), null);
  assert.equal(svgDimensions("<div>"), null);
  assert.equal(svgDimensions(""), null);
});

test("checkTemplateDimensions: PNG size and ratio, SVG ratio only, unknown skipped", () => {
  assert.equal(checkTemplateDimensions("png", { width: 1600, height: 400 }), null);
  assert.equal(checkTemplateDimensions("png", { width: 800, height: 200 }), "TEMPLATE_IMAGE_DIMENSIONS");
  assert.equal(checkTemplateDimensions("png", { width: 7000, height: 1750 }), "TEMPLATE_IMAGE_DIMENSIONS");
  assert.equal(checkTemplateDimensions("png", { width: 1600, height: 800 }), "TEMPLATE_IMAGE_RATIO");
  assert.equal(checkTemplateDimensions("svg", { width: 100, height: 25 }), null);
  assert.equal(checkTemplateDimensions("svg", { width: 100, height: 100 }), "TEMPLATE_IMAGE_RATIO");
  assert.equal(checkTemplateDimensions("svg", null), null);
});

test("errorField sends each server code to its field", () => {
  assert.equal(errorField("TEMPLATE_IMAGE_RATIO"), "image");
  assert.equal(errorField("TEMPLATE_IMAGE_UNSAFE"), "image");
  assert.equal(errorField("TEMPLATE_UPLOAD_FAILED"), "image");
  assert.equal(errorField("TEMPLATE_NAME_TAKEN"), "name");
  assert.equal(errorField("TEMPLATE_DEFINITION_INVALID"), "name");
  assert.equal(errorField("TEMPLATE_IS_DEFAULT"), "active");
  assert.equal(errorField("SOMETHING_ELSE"), "form");
  assert.equal(errorField(undefined), "form");
});

test("formatBytes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(300 * 1024), "300 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0 MB");
  assert.equal(formatBytes(-1), "");
});

test("matchesQuery and matchesFilter", () => {
  const tpl = { name: "Forest Dots", nameFil: "Gubat", isActive: true };
  assert.equal(matchesQuery(tpl, ""), true);
  assert.equal(matchesQuery(tpl, " forest "), true);
  assert.equal(matchesQuery(tpl, "GUBAT"), true);
  assert.equal(matchesQuery(tpl, "gold"), false);
  assert.equal(matchesFilter(tpl, "all"), true);
  assert.equal(matchesFilter(tpl, "active"), true);
  assert.equal(matchesFilter(tpl, "archived"), false);
  assert.equal(matchesFilter({ ...tpl, isActive: false }, "archived"), true);
});
