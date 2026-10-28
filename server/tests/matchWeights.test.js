// §C.1 configurable job-matching weights — route-level RBAC/validation/audit
// coverage, plus resolution-order unit tests against the service directly.
// Follows the same supertest-against-real-routers + mocked-models pattern as
// tests/adminJobAndNsrpTemplates.test.js.
jest.mock("../models/User", () => ({ findById: jest.fn() }));
jest.mock("../models/JobVacancy", () => ({ findById: jest.fn() }));
jest.mock("../models/SystemSettings", () => ({ getSingleton: jest.fn() }));
jest.mock("../models/MatchWeightProfile", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock("../models/MatchWeightBounds", () => ({
  getSingleton: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
// `natural`'s barrel eagerly requires its sentiment analyzer, whose
// afinn-165 dependency ships native ESM with no CJS build — see
// tests/semanticService.dimensions.test.js for the full explanation. Routing
// through jobRoutes.js pulls in jobController.js -> semanticService.js ->
// natural, so this test needs the same workaround.
jest.mock("natural", () => ({
  PorterStemmer: require("natural/lib/natural/stemmers/porter_stemmer"),
  JaroWinklerDistance: require("natural/lib/natural/distance/jaro-winkler_distance"),
  TfIdf: require("natural/lib/natural/tfidf/tfidf"),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const SystemSettings = require("../models/SystemSettings");
const MatchWeightProfile = require("../models/MatchWeightProfile");
const MatchWeightBounds = require("../models/MatchWeightBounds");
const { logAuditEvent } = require("../services/auditService");
const { CODE_FALLBACK_WEIGHTS, DIMENSION_KEYS } = require("../utils/matchWeights");

const EMPLOYER = "111111111111111111111111";
const OTHER_EMPLOYER = "222222222222222222222222";
const JOB_ID = "333333333333333333333333";
const ADMIN = "444444444444444444444444";
const SUPERADMIN = "555555555555555555555555";

const unconstrainedBounds = () => {
  const bounds = {};
  DIMENSION_KEYS.forEach((k) => { bounds[k] = { min: 0, max: 100 }; });
  return bounds;
};

const app = express();
app.use(express.json());
app.use("/employers", require("../routes/employerAccountRoutes"));
app.use("/jobs", require("../routes/jobRoutes"));
app.use("/admin", require("../routes/adminRoutes"));

const auth = (role, id) => {
  User.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ role, isActive: true, verificationStatus: "verified", tokenVersion: 0 }),
  });
  return "Bearer " + jwt.sign({ id }, process.env.JWT_SECRET);
};

// `JobVacancy.findById(id).select("employer").lean()` — a two-level chain,
// matching matchWeightsController.loadOwnedJob's exact call shape.
const mockJobLookup = (job) => {
  JobVacancy.findById.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(job) }),
  });
};

// matchWeightsService always chains `.lean()` onto MatchWeightProfile
// `findOne`/`find` calls — this wraps a resolved value in that chainable
// shape so mocks match the real Mongoose query-builder API.
const leaned = (value) => ({ lean: () => Promise.resolve(value) });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "local-test-secret";
  SystemSettings.getSingleton.mockResolvedValue({ requireEmployerVerification: true });
  MatchWeightBounds.getSingleton.mockResolvedValue({ bounds: unconstrainedBounds() });
  MatchWeightProfile.findOne.mockReturnValue(leaned(null));
  MatchWeightProfile.find.mockReturnValue(leaned([]));
  MatchWeightProfile.findOneAndUpdate.mockImplementation(async (_query, update) => ({ ...update }));
  MatchWeightProfile.deleteOne.mockResolvedValue({});
});

describe("employer default weights — /employers/match-weights", () => {
  test("GET with no saved profile resolves to the code fallback", async () => {
    const res = await request(app).get("/employers/match-weights").set("Authorization", auth("employer", EMPLOYER));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weights: CODE_FALLBACK_WEIGHTS, isCustom: false, bounds: unconstrainedBounds() });
  });

  test("PUT rejects weights that don't sum to 100", async () => {
    const res = await request(app)
      .put("/employers/match-weights")
      .set("Authorization", auth("employer", EMPLOYER))
      .send({ weights: { ...CODE_FALLBACK_WEIGHTS, skills: 50 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sum to exactly 100/);
    expect(MatchWeightProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("PUT rejects a value outside the configured bounds", async () => {
    MatchWeightBounds.getSingleton.mockResolvedValue({
      bounds: { ...unconstrainedBounds(), location: { min: 0, max: 5 } },
    });
    const weights = { ...CODE_FALLBACK_WEIGHTS, location: 9 + 20, skills: CODE_FALLBACK_WEIGHTS.skills - 20 };
    const res = await request(app)
      .put("/employers/match-weights")
      .set("Authorization", auth("employer", EMPLOYER))
      .send({ weights });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/location/);
  });

  test("PUT saves valid weights, returns isCustom:true, and audit-logs the change", async () => {
    const res = await request(app)
      .put("/employers/match-weights")
      .set("Authorization", auth("employer", EMPLOYER))
      .send({ weights: CODE_FALLBACK_WEIGHTS });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weights: CODE_FALLBACK_WEIGHTS, isCustom: true });
    expect(MatchWeightProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { owner: EMPLOYER, vacancy: null },
      expect.objectContaining({ weights: CODE_FALLBACK_WEIGHTS }),
      expect.objectContaining({ upsert: true })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorId: EMPLOYER, actorRole: "employer", action: "employer.match_weights.updated",
    }));
  });

  test("DELETE resets to the platform default and audit-logs it", async () => {
    MatchWeightProfile.findOne.mockReturnValueOnce(leaned({ weights: CODE_FALLBACK_WEIGHTS })); // "before" lookup
    const res = await request(app).delete("/employers/match-weights").set("Authorization", auth("employer", EMPLOYER));
    expect(res.status).toBe(200);
    expect(MatchWeightProfile.deleteOne).toHaveBeenCalledWith({ owner: EMPLOYER, vacancy: null });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "employer.match_weights.reset" }));
  });

  test("a non-employer role is denied", async () => {
    const res = await request(app).get("/employers/match-weights").set("Authorization", auth("jobseeker", EMPLOYER));
    expect(res.status).toBe(403);
  });
});

describe("per-vacancy override — /jobs/:id/match-weights", () => {
  test("the owning employer can read and write their job's override", async () => {
    mockJobLookup({ _id: JOB_ID, employer: EMPLOYER });
    const res = await request(app)
      .put(`/jobs/${JOB_ID}/match-weights`)
      .set("Authorization", auth("employer", EMPLOYER))
      .send({ weights: CODE_FALLBACK_WEIGHTS });
    expect(res.status).toBe(200);
    expect(MatchWeightProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { owner: EMPLOYER, vacancy: JOB_ID },
      expect.objectContaining({ weights: CODE_FALLBACK_WEIGHTS }),
      expect.objectContaining({ upsert: true })
    );
  });

  test("a different employer is denied with 403, and nothing is written", async () => {
    mockJobLookup({ _id: JOB_ID, employer: EMPLOYER });
    const res = await request(app)
      .put(`/jobs/${JOB_ID}/match-weights`)
      .set("Authorization", auth("employer", OTHER_EMPLOYER))
      .send({ weights: CODE_FALLBACK_WEIGHTS });
    expect(res.status).toBe(403);
    expect(MatchWeightProfile.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a job that doesn't exist returns 404", async () => {
    mockJobLookup(null);
    const res = await request(app).get(`/jobs/${JOB_ID}/match-weights`).set("Authorization", auth("employer", EMPLOYER));
    expect(res.status).toBe(404);
  });

  test("DELETE removes only this job's override, leaving the employer default alone", async () => {
    mockJobLookup({ _id: JOB_ID, employer: EMPLOYER });
    MatchWeightProfile.findOne.mockReturnValueOnce(leaned({ weights: CODE_FALLBACK_WEIGHTS })); // "before" lookup
    const res = await request(app).delete(`/jobs/${JOB_ID}/match-weights`).set("Authorization", auth("employer", EMPLOYER));
    expect(res.status).toBe(200);
    expect(MatchWeightProfile.deleteOne).toHaveBeenCalledWith({ vacancy: JOB_ID });
  });
});

describe("platform defaults — /admin/match-weight-defaults", () => {
  test.each(["admin", "superadmin"])("%s can read and write the platform default", async (role) => {
    const getRes = await request(app).get("/admin/match-weight-defaults").set("Authorization", auth(role, ADMIN));
    expect(getRes.status).toBe(200);
    expect(getRes.body.weights).toEqual(CODE_FALLBACK_WEIGHTS);

    const putRes = await request(app)
      .put("/admin/match-weight-defaults")
      .set("Authorization", auth(role, ADMIN))
      .send({ weights: CODE_FALLBACK_WEIGHTS });
    expect(putRes.status).toBe(200);
    expect(MatchWeightProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { owner: null, vacancy: null },
      expect.objectContaining({ weights: CODE_FALLBACK_WEIGHTS }),
      expect.objectContaining({ upsert: true })
    );
  });

  test("a plain employer is denied", async () => {
    const res = await request(app).get("/admin/match-weight-defaults").set("Authorization", auth("employer", EMPLOYER));
    expect(res.status).toBe(403);
  });
});

describe("bounds — /admin/match-weight-bounds (superadmin only)", () => {
  test("a plain admin is denied", async () => {
    const res = await request(app).get("/admin/match-weight-bounds").set("Authorization", auth("admin", ADMIN));
    expect(res.status).toBe(403);
  });

  test("superadmin can read and write bounds", async () => {
    const getRes = await request(app).get("/admin/match-weight-bounds").set("Authorization", auth("superadmin", SUPERADMIN));
    expect(getRes.status).toBe(200);
    expect(getRes.body.bounds).toEqual(unconstrainedBounds());

    const newBounds = { ...unconstrainedBounds(), location: { min: 0, max: 20 } };
    const putRes = await request(app)
      .put("/admin/match-weight-bounds")
      .set("Authorization", auth("superadmin", SUPERADMIN))
      .send({ bounds: newBounds });
    expect(putRes.status).toBe(200);
    expect(MatchWeightBounds.findOneAndUpdate).toHaveBeenCalledWith(
      { singletonKey: "global" },
      expect.objectContaining({ bounds: newBounds }),
      expect.objectContaining({ upsert: true })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorRole: "superadmin", action: "superadmin.match_weight_bounds.updated",
    }));
  });

  test("rejects an inverted min/max", async () => {
    const res = await request(app)
      .put("/admin/match-weight-bounds")
      .set("Authorization", auth("superadmin", SUPERADMIN))
      .send({ bounds: { ...unconstrainedBounds(), skills: { min: 80, max: 20 } } });
    expect(res.status).toBe(400);
  });

  // P0-05 — every individual bound can pass min<=max while the SET of bounds
  // is still infeasible: ten minima of 20 each pass one-by-one but require a
  // combined total of >=200, so no weight vector could ever satisfy all ten
  // at once while summing to 100.
  test("rejects minimums that sum past 100% even though each is individually valid", async () => {
    const infeasibleBounds = {};
    DIMENSION_KEYS.forEach((k) => { infeasibleBounds[k] = { min: 20, max: 100 }; });
    const res = await request(app)
      .put("/admin/match-weight-bounds")
      .set("Authorization", auth("superadmin", SUPERADMIN))
      .send({ bounds: infeasibleBounds });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Minimums sum to 200%/);
  });

  test("rejects maximums that sum under 100%", async () => {
    const infeasibleBounds = {};
    DIMENSION_KEYS.forEach((k) => { infeasibleBounds[k] = { min: 0, max: 5 }; });
    const res = await request(app)
      .put("/admin/match-weight-bounds")
      .set("Authorization", auth("superadmin", SUPERADMIN))
      .send({ bounds: infeasibleBounds });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Maximums sum to 50%/);
  });
});

// ------------------------------------------------------------------
// Resolution order — the actual "does a saved profile change scoring"
// behaviour, tested directly against the service (not HTTP), per the
// handoff doc's own verification bar.
// ------------------------------------------------------------------
describe("matchWeightsService resolution order", () => {
  const matchWeightsService = require("../services/matchWeightsService");
  const CUSTOM = { ...CODE_FALLBACK_WEIGHTS, skills: 50, title: CODE_FALLBACK_WEIGHTS.title - 23 };
  const EMPLOYER_DEFAULT = { ...CODE_FALLBACK_WEIGHTS, industry: 30, skills: CODE_FALLBACK_WEIGHTS.skills - 20 };
  const PLATFORM_DEFAULT = { ...CODE_FALLBACK_WEIGHTS, language: 20, skills: CODE_FALLBACK_WEIGHTS.skills - 16 };

  test("falls all the way back to the code fallback when nothing is configured", async () => {
    const job = { _id: JOB_ID, employer: EMPLOYER };
    const weights = await matchWeightsService.resolveJobWeightsForScoring(job);
    expect(weights).toEqual(CODE_FALLBACK_WEIGHTS);
  });

  test("platform default wins over the code fallback when set", async () => {
    MatchWeightProfile.findOne.mockImplementation((query) => {
      if (query.owner === null && query.vacancy === null) return leaned({ weights: PLATFORM_DEFAULT });
      return leaned(null);
    });
    const job = { _id: JOB_ID, employer: EMPLOYER };
    const weights = await matchWeightsService.resolveJobWeightsForScoring(job);
    expect(weights).toEqual(PLATFORM_DEFAULT);
  });

  test("employer default wins over the platform default", async () => {
    MatchWeightProfile.findOne.mockImplementation((query) => {
      if (query.owner === null && query.vacancy === null) return leaned({ weights: PLATFORM_DEFAULT });
      if (query.owner === EMPLOYER && query.vacancy === null) return leaned({ weights: EMPLOYER_DEFAULT });
      return leaned(null);
    });
    const job = { _id: JOB_ID, employer: EMPLOYER };
    const weights = await matchWeightsService.resolveJobWeightsForScoring(job);
    expect(weights).toEqual(EMPLOYER_DEFAULT);
  });

  test("a per-vacancy override wins over everything else", async () => {
    MatchWeightProfile.findOne.mockImplementation((query) => {
      if (query.vacancy === JOB_ID) return leaned({ weights: CUSTOM });
      if (query.owner === null && query.vacancy === null) return leaned({ weights: PLATFORM_DEFAULT });
      if (query.owner === EMPLOYER && query.vacancy === null) return leaned({ weights: EMPLOYER_DEFAULT });
      return leaned(null);
    });
    const job = { _id: JOB_ID, employer: EMPLOYER };
    const weights = await matchWeightsService.resolveJobWeightsForScoring(job);
    expect(weights).toEqual(CUSTOM);
  });

  test("buildWeightsByJobId batch-resolves the same chain across many jobs in exactly 3 queries", async () => {
    const jobA = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", employer: EMPLOYER };
    const jobB = { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", employer: OTHER_EMPLOYER };
    const jobC = { _id: "cccccccccccccccccccccccc", employer: EMPLOYER };

    MatchWeightProfile.find.mockImplementation((query) => {
      if (query.vacancy) return leaned([{ vacancy: "aaaaaaaaaaaaaaaaaaaaaaaa", weights: CUSTOM }]); // jobA has an override
      if (query.owner) return leaned([{ owner: EMPLOYER, weights: EMPLOYER_DEFAULT }]); // only EMPLOYER has a default
      return leaned([]);
    });
    MatchWeightProfile.findOne.mockReturnValue(leaned({ weights: PLATFORM_DEFAULT }));

    const result = await matchWeightsService.buildWeightsByJobId([jobA, jobB, jobC]);

    expect(result["aaaaaaaaaaaaaaaaaaaaaaaa"]).toEqual(CUSTOM); // override wins
    expect(result["cccccccccccccccccccccccc"]).toEqual(EMPLOYER_DEFAULT); // same employer, no override -> their default
    expect(result["bbbbbbbbbbbbbbbbbbbbbbbb"]).toEqual(PLATFORM_DEFAULT); // different employer, no default of their own -> platform
    expect(MatchWeightProfile.find).toHaveBeenCalledTimes(2); // overrides + employer defaults
    expect(MatchWeightProfile.findOne).toHaveBeenCalledTimes(1); // platform default
  });

  test("a resolved weights object actually changes computeUnifiedScore's output", () => {
    const { computeUnifiedScore } = require("../services/semanticService");
    const job = { title: "Clerk", qualifications: [{ type: "skill", value: "encoding", optional: false }], industry: "Finance" };
    // Skills match perfectly (score 1); industry preference does NOT match
    // this job's industry (score 0.25) — so shifting weight between the two
    // dimensions (EMPLOYER_DEFAULT pushes weight from skills to industry)
    // actually moves the overall weighted average, unlike two dimensions
    // that are both already maxed out.
    const applicant = {
      user: { skills: ["encoding"] },
      profile: { skills: ["encoding"], preferredIndustries: ["retail"] },
    };
    const withFallback = computeUnifiedScore(job, applicant, null, CODE_FALLBACK_WEIGHTS);
    const withCustom = computeUnifiedScore(job, applicant, null, EMPLOYER_DEFAULT); // industry weighted much higher
    expect(withCustom.score).not.toBe(withFallback.score);
  });
});
