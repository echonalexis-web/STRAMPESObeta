jest.mock("../models/User", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
jest.mock("../services/systemOptionService", () => ({ getActiveValues: jest.fn().mockResolvedValue(new Set(["Passport"])) }));
jest.mock("../utils/profileCompleteness", () => ({ computeProfileCompleteness: jest.fn(() => null) }));
jest.mock("../services/ocrService", () => ({ extractText: jest.fn() }));
const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const ocr = require("../services/ocrService");
const idOcr = require("../services/idOcrService");
const controller = require("../controllers/authController");
const { confirmIdOcr } = require("../controllers/idOcrController");
const idUploadLimit = require("../middleware/idUploadLimit");
const { logAuditEvent } = require("../services/auditService");
const id = "507f1f77bcf86cd799439011";
const file = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: "image/png", originalname: "id.png", size: 8, storedValue: "private:new-id" };

// Every test establishes fresh implementations, including the query chains.
beforeEach(() => { jest.clearAllMocks(); User.findByIdAndUpdate.mockResolvedValue({}); });
const appFor = (field, role = "jobseeker", body = {}) => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id, role }; req.files = field ? { [field]: [file] } : {}; Object.assign(req.body, body); next(); });
  app.put("/profile", controller.updateProfile); app.post("/confirm", confirmIdOcr); app.post("/limit", idUploadLimit, (_req, res) => res.json({ ok: true }));
  return app;
};
test.each(["validIdFile", "supportingDocument"])("%s save returns queued without waiting for extraction", async (field) => {
  const current = { _id: id, role: "jobseeker", name: "Maria" };
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(current) });
  const schedule = jest.spyOn(idOcr, "runIdOcr");
  // The real async scheduler calls the closed-over function; model mocks stop
  // it before the engine. Capture runId from the persisted update instead.
  User.findOneAndUpdate.mockResolvedValue(null);
  const response = await request(appFor(field)).put("/profile").send({});
  expect(response.status).toBe(200);
  const update = User.findByIdAndUpdate.mock.calls[0][1];
  expect(update.governmentIdOcr).toMatchObject({ status: "queued", runId: expect.any(String) });
  expect(update.governmentIdNumber).toBeUndefined();
  await new Promise(setImmediate);
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ validIdFile: file.storedValue, "governmentIdOcr.runId": update.governmentIdOcr.runId }), expect.any(Object), expect.any(Object));
  schedule.mockRestore();
});
test("engine failure is persisted safely and never edits authoritative fields", async () => {
  User.findOneAndUpdate.mockResolvedValueOnce({ name: "Maria", role: "jobseeker" }).mockResolvedValueOnce({ _id: id });
  ocr.extractText.mockRejectedValue(new Error("private image contents"));
  const emit = jest.fn(), io = { to: jest.fn(() => ({ emit })) };
  await idOcr.runIdOcr({ userId: id, runId: "run", file, io });
  expect(ocr.extractText).toHaveBeenCalledWith(file.buffer, file.mimetype);
  expect(User.findOneAndUpdate.mock.calls[1][1]).toEqual({ $set: { governmentIdOcr: expect.objectContaining({ status: "failed", failureReason: "processing_failed" }) } });
  expect(JSON.stringify(User.findOneAndUpdate.mock.calls)).not.toContain("private image contents");
  expect(emit).toHaveBeenCalledWith("id:ocr:done", expect.any(Object));
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.id.ocr_processed" }));
});
test("replaced upload results are discarded", async () => {
  User.findOneAndUpdate.mockResolvedValue(null);
  await idOcr.runIdOcr({ userId: id, runId: "stale", file });
  expect(ocr.extractText).not.toHaveBeenCalled();
});
test("confirmation rejects stale run IDs and accepts edited user values", async () => {
  const select = jest.fn().mockResolvedValue(null); User.findOneAndUpdate.mockReturnValue({ select });
  const app = appFor(null);
  expect((await request(app).post("/confirm").send({ runId: "stale", governmentIdType: "Passport", governmentIdNumber: "USER-EDITED" })).status).toBe(409);
  select.mockResolvedValue({ _id: id, governmentIdNumber: "USER-EDITED" });
  expect((await request(app).post("/confirm").send({ runId: "current", governmentIdType: "Passport", governmentIdNumber: "USER-EDITED" })).status).toBe(200);
  expect(User.findOneAndUpdate.mock.calls[1][1].$set.governmentIdNumber).toBe("USER-EDITED");
});
test("per-account upload allowance rejects before downstream storage", async () => {
  User.updateOne.mockResolvedValue({ modifiedCount: 0 });
  expect((await request(appFor("supportingDocument")).post("/limit").send({})).status).toBe(429);
  expect(User.updateOne.mock.calls[1][0]).toEqual({ _id: id, idUploadCount: { $lt: 5 } });
});
