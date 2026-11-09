// Batch 0e: follower and following lists are visible only to the owner and PESO
// staff. Counts stay available through follow-status.

jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/Follow", () => ({ countDocuments: jest.fn(), find: jest.fn(), findOne: jest.fn() }));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../services/notificationService", () => ({ createNotificationForUser: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require("express");
const request = require("supertest");

const User = require("../models/User");
const Follow = require("../models/Follow");
const followController = require("../controllers/followController");

const appFor = (user) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get("/:userId/followers", followController.getFollowers);
  app.get("/:userId/following", followController.getFollowing);
  app.get("/:userId/follow-status", followController.getFollowStatus);
  return app;
};

describe("follower and following lists", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    User.findById.mockResolvedValue({ _id: "target" });
    Follow.countDocuments.mockResolvedValue(2);
    Follow.findOne.mockResolvedValue(null);
    const chain = { populate: () => chain, skip: () => chain, limit: () => chain, sort: () => Promise.resolve([]) };
    Follow.find.mockReturnValue(chain);
  });

  test.each(["followers", "following"])("another signed-in user gets 403 FOLLOW_LIST_PRIVATE on %s", async (which) => {
    const res = await request(appFor({ id: "someoneElse", role: "jobseeker" })).get(`/target/${which}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FOLLOW_LIST_PRIVATE");
    expect(User.findById).not.toHaveBeenCalled();
  });

  test("an employer cannot list a jobseeker's following", async () => {
    const res = await request(appFor({ id: "emp1", role: "employer" })).get("/target/following");
    expect(res.status).toBe(403);
  });

  test.each([
    ["owner", { id: "target", role: "employer" }],
    ["admin", { id: "adm", role: "admin" }],
    ["superadmin", { id: "sa", role: "superadmin" }],
  ])("%s can read both lists", async (_n, user) => {
    expect((await request(appFor(user)).get("/target/followers")).status).toBe(200);
    expect((await request(appFor(user)).get("/target/following")).status).toBe(200);
  });

  test("counts stay public to any signed-in user", async () => {
    const res = await request(appFor({ id: "someoneElse", role: "jobseeker" })).get("/target/follow-status");
    expect(res.status).toBe(200);
    expect(res.body.data.followerCount).toBe(2);
  });
});
