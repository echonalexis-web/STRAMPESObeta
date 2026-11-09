// Database-backed rate-limit store, with a fake model (no database).
jest.mock("../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const express = require("express");
const request = require("supertest");
const rateLimit = require("express-rate-limit");
const { MongoRateLimitStore } = require("../middleware/mongoRateLimitStore");
const { buildRegisterLimiters } = require("../middleware/registerLimiter");

// Minimal in-memory stand-in for the three model calls the store makes.
const fakeModel = () => {
  const docs = new Map();
  return {
    docs,
    findOneAndUpdate: jest.fn(async ({ _id }, update) => {
      const doc = docs.get(_id) || { _id, count: 0, expiresAt: update.$setOnInsert.expiresAt };
      doc.count += update.$inc.count;
      docs.set(_id, doc);
      return { ...doc };
    }),
    updateOne: jest.fn(async ({ _id }, update) => {
      const doc = docs.get(_id);
      if (doc && doc.count > 0) doc.count += update.$inc.count;
    }),
    deleteOne: jest.fn(async ({ _id }) => docs.delete(_id)),
  };
};

describe("MongoRateLimitStore", () => {
  test("counts per key and bucket, and reports the window end", async () => {
    const model = fakeModel();
    let t = 1_000_000;
    const store = new MongoRateLimitStore({ model, name: "x", now: () => t });
    store.init({ windowMs: 60_000 });
    expect((await store.increment("1.1.1.1")).totalHits).toBe(1);
    const second = await store.increment("1.1.1.1");
    expect(second.totalHits).toBe(2);
    expect(second.resetTime.getTime()).toBe((Math.floor(t / 60_000) + 1) * 60_000);
    expect((await store.increment("2.2.2.2")).totalHits).toBe(1); // separate key
    t += 60_000; // next window starts fresh
    expect((await store.increment("1.1.1.1")).totalHits).toBe(1);
  });

  test("two stores on the same model share counts, as two instances would", async () => {
    const model = fakeModel();
    const a = new MongoRateLimitStore({ model, name: "x", now: () => 5 });
    const b = new MongoRateLimitStore({ model, name: "x", now: () => 5 });
    a.init({ windowMs: 60_000 });
    b.init({ windowMs: 60_000 });
    await a.increment("ip");
    expect((await b.increment("ip")).totalHits).toBe(2);
  });

  test("limiter names do not share counters", async () => {
    const model = fakeModel();
    const a = new MongoRateLimitStore({ model, name: "hour", now: () => 5 });
    const b = new MongoRateLimitStore({ model, name: "day", now: () => 5 });
    a.init({ windowMs: 60_000 });
    b.init({ windowMs: 60_000 });
    await a.increment("ip");
    expect((await b.increment("ip")).totalHits).toBe(1);
  });

  test("decrement and reset", async () => {
    const model = fakeModel();
    const s = new MongoRateLimitStore({ model, name: "x", now: () => 5 });
    s.init({ windowMs: 60_000 });
    await s.increment("ip");
    await s.increment("ip");
    await s.decrement("ip");
    expect((await s.increment("ip")).totalHits).toBe(2);
    await s.resetKey("ip");
    expect((await s.increment("ip")).totalHits).toBe(1);
  });

  test("retries once on a duplicate-key race at first insert", async () => {
    const model = fakeModel();
    const real = model.findOneAndUpdate;
    model.findOneAndUpdate = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }))
      .mockImplementation(real);
    const s = new MongoRateLimitStore({ model, name: "x", now: () => 5 });
    s.init({ windowMs: 60_000 });
    expect((await s.increment("ip")).totalHits).toBe(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  test("fails open when the database errors", async () => {
    const model = { findOneAndUpdate: jest.fn().mockRejectedValue(new Error("down")) };
    const s = new MongoRateLimitStore({ model, name: "x", now: () => 5 });
    s.init({ windowMs: 60_000 });
    expect((await s.increment("ip")).totalHits).toBe(1);
  });
});

describe("registerLimiter on the database store", () => {
  beforeEach(() => {
    process.env.USERNAME_SIGNUP_ENABLED = "true";
    process.env.SIGNUP_LIMIT_PER_HOUR = "2";
  });
  afterEach(() => {
    delete process.env.USERNAME_SIGNUP_ENABLED;
    delete process.env.SIGNUP_LIMIT_PER_HOUR;
  });

  const build = (model) => {
    const app = express();
    app.use(express.json());
    app.use(
      "/auth/register",
      buildRegisterLimiters((o) => rateLimit(o), (name) => new MongoRateLimitStore({ model, name }))
    );
    app.post("/auth/register", (req, res) => res.status(201).json({}));
    return app;
  };

  test("a restarted app (new limiter objects, same database) keeps the count", async () => {
    const model = fakeModel();
    const first = build(model);
    expect((await request(first).post("/auth/register").send({})).status).toBe(201);
    expect((await request(first).post("/auth/register").send({})).status).toBe(201);
    const second = build(model);
    const res = await request(second).post("/auth/register").send({});
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });
});
