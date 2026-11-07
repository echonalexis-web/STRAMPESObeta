jest.mock("tesseract.js", () => ({ createWorker: jest.fn() }));
jest.mock("sharp", () => jest.fn());
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");
const { extractText } = require("../services/ocrService");
const { recognizeImage } = require("../services/ocrWorker");
const { parseIdText, parseDate, nameMatchScore } = require("../utils/idOcrParser");

// Reset implementations as well as history: each engine test owns its worker.
beforeEach(() => { jest.resetAllMocks(); delete process.env.OCR_ENGINE; delete process.env.OCR_LANG_PATH; });
afterAll(() => { delete process.env.OCR_ENGINE; });

test("off and unsupported documents never start an OCR worker", async () => {
  process.env.OCR_ENGINE = "off";
  expect(await extractText(Buffer.from("id"), "image/png")).toMatchObject({ engine: "off", unsupported: true });
  delete process.env.OCR_ENGINE;
  expect(await extractText(Buffer.from("pdf"), "application/pdf")).toMatchObject({ unsupported: true });
  expect(createWorker).not.toHaveBeenCalled();
});

test.each([false, true])("engine always terminates the worker (recognition failure: %s)", async (reject) => {
  const chain = {};
  for (const method of ["rotate", "resize", "grayscale", "normalize", "png"]) chain[method] = jest.fn(() => chain);
  chain.toBuffer = jest.fn().mockResolvedValue(Buffer.from("processed")); sharp.mockReturnValue(chain);
  const worker = { recognize: reject ? jest.fn().mockRejectedValue(new Error("bad image")) : jest.fn().mockResolvedValue({ data: { text: "PASSPORT", confidence: 87 } }), terminate: jest.fn().mockResolvedValue() };
  createWorker.mockResolvedValue(worker);
  const langPath = require("@tesseract.js-data/eng").langPath;
  if (reject) await expect(recognizeImage(Buffer.from("id"), langPath)).rejects.toThrow("bad image");
  else expect(await recognizeImage(Buffer.from("id"), langPath)).toEqual({ text: "PASSPORT", confidence: .87 });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(sharp).toHaveBeenCalledWith(expect.any(Buffer), { limitInputPixels: 24000000 });
});

test("unconfigured paid engines fail explicitly instead of uploading data", async () => {
  process.env.OCR_ENGINE = "vision";
  await expect(extractText(Buffer.from("id"), "image/png")).rejects.toThrow("not configured");
  expect(createWorker).not.toHaveBeenCalled();
});

const user = { name: "Maria Clara Reyes", dateOfBirth: "1990-02-03", governmentIdType: "Passport" };
test("parser extracts labelled fields, dates and advisory checks", () => {
  const result = parseIdText("PASSPORT\nSURNAME: REYES\nGIVEN NAMES: MARIA\nMIDDLE NAME: CLARA\nP1234567A\nDATE OF BIRTH: 03 FEB 1990\nDATE OF EXPIRY: 2030-01-01\nADDRESS: BOAC", user, new Set(["Passport"]), new Date("2026-10-28"));
  expect(result.extracted).toMatchObject({ idNumber: "P1234567A", fullName: "MARIA CLARA REYES", detectedType: "Passport", address: "BOAC" });
  expect(result.checks).toMatchObject({ numberFormatValid: true, nameMatchScore: 1, dobMatch: true, typeMatchesDeclared: true, expired: false });
});
test("inactive catalog types and missing fields stay unknown", () => {
  const result = parseIdText("PASSPORT\nP1234567A", {}, new Set(["Custom ID"]));
  expect(result.extracted.detectedType).toBeNull();
  expect(result.extracted.idNumber).toBeNull();
  expect(Object.values(result.checks).every((value) => value === null)).toBe(true);
});
test("name matching handles accents/order and incomplete names conservatively", () => {
  expect(nameMatchScore("Dela Cruz, José", "Jose Dela Cruz")).toBe(1);
  expect(nameMatchScore("Maria", "Maria Reyes")).toBeCloseTo(2 / 3);
  expect(nameMatchScore(null, "Maria")).toBeNull();
});
test.each(["2025-02-29", "2024-13-01", "03/04/1990", "invalid", "31 APR 1990"])("invalid or ambiguous date %s remains unknown", (value) => expect(parseDate(value)).toBeNull());
test("valid leap date is preserved", () => expect(parseDate("2024-02-29").toISOString()).toBe("2024-02-29T00:00:00.000Z"));
test("UMID is distinguished from its SSS issuing agency", () => {
  expect(parseIdText("SOCIAL SECURITY SYSTEM\nUNIFIED MULTI-PURPOSE ID\nCRN: 1234-5678901-2", {}, new Set(["SSS ID", "UMID"])).extracted.detectedType).toBe("UMID");
});
test("a labelled malformed number is retained for correction and flagged", () => {
  const result = parseIdText("SOCIAL SECURITY SYSTEM\nSSS NO: 12-34567-0", {}, new Set(["SSS ID"]));
  expect(result.extracted.idNumber).toBe("12-34567-0"); expect(result.checks.numberFormatValid).toBe(false);
});
test("catalog values matching object prototype names remain unknown", () => {
  expect(parseIdText("example", {}, new Set(["constructor", "__proto__"])).extracted.detectedType).toBeNull();
});
