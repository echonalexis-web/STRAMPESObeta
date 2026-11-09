// Batch 0d: user search never returns email to non-staff, excludes hidden
// profiles and minors for employers, and employers cannot start a conversation
// with a minor.

jest.mock("../models/User", () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock("../models/Conversation", () => ({ findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock("../models/Message", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/notificationService", () => ({ notifyNewMessage: jest.fn() }));
jest.mock("../services/presenceService", () => ({}));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const messageController = require("../controllers/messageController");

const yearsAgo = (n, dayOffset = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const appFor = (role, handler, path = "/x", method = "get") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "me", role };
    next();
  });
  app[method](path, handler);
  return app;
};

describe("searchUsers", () => {
  const candidates = () => [
    { name: "Adult Ana", role: "jobseeker", dateOfBirth: yearsAgo(25), email: "ana@x.com", toObject() { return { name: this.name, role: this.role, dateOfBirth: this.dateOfBirth }; } },
    { name: "Teen Tim", role: "jobseeker", dateOfBirth: yearsAgo(16), toObject() { return { name: this.name, role: this.role, dateOfBirth: this.dateOfBirth }; } },
    { name: "No Dob", role: "jobseeker", dateOfBirth: null, toObject() { return { name: this.name, role: this.role }; } },
  ];
  const setup = () => {
    const select = jest.fn().mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(candidates()) }) });
    User.find.mockReturnValue({ select });
    return select;
  };
  beforeEach(() => jest.resetAllMocks());

  test("employer: no email in query or select, hidden excluded, minors and unknown age dropped, no DOB in result", async () => {
    const select = setup();
    const res = await request(appFor("employer", messageController.searchUsers)).get("/x?query=ana");
    expect(res.status).toBe(200);
    const filter = User.find.mock.calls[0][0];
    expect(JSON.stringify(filter.$or)).not.toContain("email");
    expect(filter["privacy.profileVisibility"]).toEqual({ $ne: "hidden" });
    expect(select.mock.calls[0][0].split(" ")).not.toContain("email");
    expect(res.body.map((u) => u.name)).toEqual(["Adult Ana"]);
    expect(JSON.stringify(res.body)).not.toContain("dateOfBirth");
    expect(JSON.stringify(res.body)).not.toContain("ana@x.com");
  });

  test("staff may still search by email", async () => {
    const select = setup();
    await request(appFor("admin", messageController.searchUsers)).get("/x?query=ana");
    expect(JSON.stringify(User.find.mock.calls[0][0].$or)).toContain("email");
    expect(select.mock.calls[0][0].split(" ")).toContain("email");
  });

  test("a jobseeker searching employers never matches on email", async () => {
    setup();
    await request(appFor("jobseeker", messageController.searchUsers)).get("/x?query=acme");
    expect(JSON.stringify(User.find.mock.calls[0][0].$or)).not.toContain("email");
  });
});

describe("createConversation by an employer", () => {
  const build = (target) => {
    User.findById.mockImplementation((id) => ({
      select: jest.fn().mockResolvedValue(id === "me" ? { role: "employer", isActive: true } : target),
    }));
    return appFor("employer", messageController.createConversation, "/c", "post");
  };
  beforeEach(() => jest.resetAllMocks());

  test("refused for a 16-year-old with MESSAGING_MINOR_RESTRICTED", async () => {
    const res = await request(build({ role: "jobseeker", isActive: true, dateOfBirth: yearsAgo(16, -30) })).post("/c").send({ participantId: "other" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MESSAGING_MINOR_RESTRICTED");
  });

  test("refused for an unknown date of birth", async () => {
    const res = await request(build({ role: "jobseeker", isActive: true, dateOfBirth: null })).post("/c").send({ participantId: "other" });
    expect(res.body.code).toBe("MESSAGING_MINOR_RESTRICTED");
  });
});
