// POST /users/me/dob used to pass the sensitiveOperationLimiter factory itself
// as middleware, so every request hung and setMyDateOfBirth never ran.
jest.mock("../middleware/auth", () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: "dummy-user" };
    next();
  },
}));
jest.mock("../controllers/userController", () => {
  const ok = (_req, res) => res.json({ ok: true });
  return {
    completeOnboarding: ok,
    getProfile: ok,
    updateProfile: ok,
    uploadProfileImage: ok,
    changePassword: ok,
    uploadResume: ok,
    setMyDateOfBirth: jest.fn((_req, res) => res.json({ ok: true })),
  };
});

const express = require("express");
const request = require("supertest");
const { setMyDateOfBirth } = require("../controllers/userController");
const userRoutes = require("../routes/userRoutes");

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/users", userRoutes);
  return app;
};

test("the date-of-birth endpoint reaches its handler instead of hanging", async () => {
  const res = await request(makeApp()).post("/users/me/dob").send({ dateOfBirth: "2000-01-01" }).timeout(3000);
  expect(res.status).toBe(200);
  expect(setMyDateOfBirth).toHaveBeenCalledTimes(1);
});

test("the date-of-birth endpoint is rate limited", async () => {
  const app = makeApp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).post("/users/me/dob").send({ dateOfBirth: "2000-01-01" }).timeout(3000);
    statuses.push(res.status);
  }
  // The first test already used one slot in this module's limiter.
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  expect(statuses[statuses.length - 1]).toBe(429);
});
