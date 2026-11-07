jest.mock("../models/User", () => ({ findOne: jest.fn() }));
jest.mock("../models/AccountRecoveryRequest", () => ({ findOne: jest.fn() }));
jest.mock("../services/storageService", () => ({ isRemoteUrl: jest.fn(() => false), isPrivateRef: jest.fn(() => true), getSignedUrl: jest.fn().mockResolvedValue("https://signed.example/id") }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
const User = require("../models/User");
const Recovery = require("../models/AccountRecoveryRequest");
const { getSignedUrl, canAccessRef } = require("../controllers/fileController");
const { logAuditEvent } = require("../services/auditService");
beforeEach(() => jest.clearAllMocks());
const chain = (value) => ({ select: jest.fn().mockResolvedValue(value) });
test.each(["admin", "superadmin"])("%s ID viewing is authorized and audited", async (role) => {
  User.findOne.mockReturnValue(chain({ _id: "owner" }));
  const req = { query: { ref: "private:id" }, user: { id: "staff", role } }, res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await getSignedUrl(req, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ url: "https://signed.example/id" }));
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.id.viewed", actorId: "staff", targetId: "owner" }));
});
test("recovery ID/selfie views are audited against their request", async () => {
  User.findOne.mockReturnValue(chain(null)); Recovery.findOne.mockReturnValue(chain({ _id: "request" }));
  await getSignedUrl({ query: { ref: "private:selfie" }, user: { id: "staff", role: "admin" } }, { json: jest.fn(), status: jest.fn().mockReturnThis() });
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.id.viewed", targetType: "accountRecovery", targetId: "request" }));
});
test("anonymous file access is denied", async () => expect(await canAccessRef("private:id", null)).toBe(false));
