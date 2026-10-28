// Tier 2 ("Engine overhaul") coverage — markdowns/JOB_MATCHMAKING_IMPROVEMENT_PLAN.md
// §C.3: "Every new dimension needs an explicit null case, and a test for it."
// Covers the weights refactor (§C.1), the two new dimensions (§A.1), and the
// employer-side industry rescoring (§B.2). Pure unit tests against the
// exported scoring functions — no DB/mongoose involved, since these are all
// plain-object-in, plain-object-out functions.
//
// `natural`'s top-level barrel (lib/natural/index.js) eagerly requires its
// sentiment analyzer, whose `afinn-165` dependency ships native ESM
// (`export const …`) with no CJS build — Jest's default transform ignores
// node_modules and can't parse that, even though semanticService.js never
// uses sentiment analysis. Re-export the three submodules it actually uses
// (PorterStemmer, JaroWinklerDistance, TfIdf) directly from their own files,
// which sidesteps the barrel — and its sentiment chain — entirely. These are
// the real implementations, not stubs.
jest.mock("natural", () => ({
  PorterStemmer: require("natural/lib/natural/stemmers/porter_stemmer"),
  JaroWinklerDistance: require("natural/lib/natural/distance/jaro-winkler_distance"),
  TfIdf: require("natural/lib/natural/tfidf/tfidf"),
}));

const {
  computeUnifiedScore,
  rankApplicantsByJob,
  DEFAULT_DIMENSION_WEIGHTS,
} = require("../services/semanticService");

// A minimal job/applicant pair that always has a scoreable `skills` match,
// so `computeUnifiedScore()` never returns the overall-null ("no dimension
// had data anywhere") result while we're isolating one other dimension.
function baseJob(overrides = {}) {
  return Object.assign(
    {
      title: "Clerk",
      qualifications: [{ type: "skill", value: "encoding", optional: false }],
      location: "BOAC, MARINDUQUE, REGION IV-B",
      jobType: "Full-time",
      workNature: "onsite",
      industry: "Government Services",
    },
    overrides
  );
}

function baseApplicant(profileOverrides = {}) {
  return {
    user: { skills: ["encoding"] },
    profile: Object.assign(
      {
        skills: ["encoding"],
        workHistory: [],
        vocationalTrainings: [],
        preferredIndustries: [],
        presentAddress: null,
        preferredWorkLocationLocal: [],
        preferredJobTypes: [],
        preferredWorkNature: [],
      },
      profileOverrides
    ),
  };
}

describe("§C.1 weights refactor", () => {
  test("omitting `weights` and passing DEFAULT_DIMENSION_WEIGHTS explicitly are identical (zero behaviour change)", () => {
    const job = baseJob();
    const applicant = baseApplicant();
    const implicit = computeUnifiedScore(job, applicant);
    const explicit = computeUnifiedScore(job, applicant, null, DEFAULT_DIMENSION_WEIGHTS);
    expect(explicit).toEqual(implicit);
  });

  test("DEFAULT_DIMENSION_WEIGHTS covers all ten dimensions and sums to 1.00", () => {
    const keys = Object.keys(DEFAULT_DIMENSION_WEIGHTS);
    expect(keys.sort()).toEqual(
      ["credentials", "education", "employmentType", "experience", "industry", "language", "location", "salary", "skills", "title"].sort()
    );
    const sum = Object.values(DEFAULT_DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("a custom weights table restricts scoring to only the supplied dimensions", () => {
    const job = baseJob();
    const applicant = baseApplicant();
    const res = computeUnifiedScore(job, applicant, null, { skills: 1 });
    expect(Object.keys(res.breakdown)).toEqual(["skills"]);
    expect(res.score).toBe(1);
  });
});

describe("§A.1 location dimension", () => {
  test("same municipality/city scores 1.0", () => {
    const job = baseJob();
    const applicant = baseApplicant({
      presentAddress: { municipality: "Boac", province: "Marinduque", region: "REGION IV-B" },
    });
    expect(computeUnifiedScore(job, applicant).breakdown.location).toBe(1);
  });

  test("same province, different municipality scores 0.6", () => {
    const job = baseJob();
    const applicant = baseApplicant({
      presentAddress: { municipality: "Gasan", province: "Marinduque", region: "REGION IV-B" },
    });
    expect(computeUnifiedScore(job, applicant).breakdown.location).toBe(0.6);
  });

  test("same region, different province scores 0.3", () => {
    const job = baseJob();
    const applicant = baseApplicant({
      presentAddress: { municipality: "Abra de Ilog", province: "Occidental Mindoro", region: "REGION IV-B" },
    });
    expect(computeUnifiedScore(job, applicant).breakdown.location).toBe(0.3);
  });

  test("different region entirely scores 0.1", () => {
    const job = baseJob();
    const applicant = baseApplicant({
      presentAddress: { municipality: "Malaybalay", province: "Bukidnon", region: "REGION X" },
    });
    expect(computeUnifiedScore(job, applicant).breakdown.location).toBe(0.1);
  });

  test("a stated preferredWorkLocationLocal entry outranks presentAddress", () => {
    const job = baseJob();
    const applicant = baseApplicant({
      preferredWorkLocationLocal: ["Boac, Marinduque"],
      presentAddress: { municipality: "Malaybalay", province: "Bukidnon", region: "REGION X" },
    });
    expect(computeUnifiedScore(job, applicant).breakdown.location).toBe(1);
  });

  test("null: remote vacancy (workNature) is not penalised for distance", () => {
    const job = baseJob({ workNature: "remote" });
    const applicant = baseApplicant({
      presentAddress: { municipality: "Boac", province: "Marinduque", region: "REGION IV-B" },
    });
    expect("location" in computeUnifiedScore(job, applicant).breakdown).toBe(false);
  });

  test("null: remote vacancy (jobType === 'Remote') is also not penalised", () => {
    const job = baseJob({ jobType: "Remote", workNature: null });
    const applicant = baseApplicant({
      presentAddress: { municipality: "Boac", province: "Marinduque", region: "REGION IV-B" },
    });
    expect("location" in computeUnifiedScore(job, applicant).breakdown).toBe(false);
  });

  test("null: applicant has neither a stated preference nor a usable address", () => {
    const job = baseJob();
    const applicant = baseApplicant();
    expect("location" in computeUnifiedScore(job, applicant).breakdown).toBe(false);
  });

  test("null: the vacancy's location string can't be parsed at all", () => {
    const job = baseJob({ location: "Somewhere Nobody Has Heard Of" });
    const applicant = baseApplicant({
      presentAddress: { municipality: "Boac", province: "Marinduque", region: "REGION IV-B" },
    });
    expect("location" in computeUnifiedScore(job, applicant).breakdown).toBe(false);
  });
});

describe("§A.1 employment-type dimension", () => {
  test("matching job type and work nature scores 1.0", () => {
    const job = baseJob({ jobType: "Full-time", workNature: "onsite" });
    const applicant = baseApplicant({ preferredJobTypes: ["Full-time"], preferredWorkNature: ["Onsite"] });
    expect(computeUnifiedScore(job, applicant).breakdown.employmentType).toBe(1);
  });

  test("workNature case mismatch (lowercase vacancy vs Capitalised preference) still matches", () => {
    const job = baseJob({ jobType: "Full-time", workNature: "hybrid" });
    const applicant = baseApplicant({ preferredJobTypes: [], preferredWorkNature: ["Hybrid"] });
    expect(computeUnifiedScore(job, applicant).breakdown.employmentType).toBe(1);
  });

  test("job type mismatched but work nature matched blends to 0.5", () => {
    const job = baseJob({ jobType: "Part-time", workNature: "onsite" });
    const applicant = baseApplicant({ preferredJobTypes: ["Full-time"], preferredWorkNature: ["Onsite"] });
    expect(computeUnifiedScore(job, applicant).breakdown.employmentType).toBe(0.5);
  });

  test("jobType 'Remote' is never compared against preferredJobTypes (it has no Remote option) — scores from workNature alone", () => {
    const job = baseJob({ jobType: "Remote", workNature: null });
    const applicant = baseApplicant({ preferredJobTypes: ["Full-time"], preferredWorkNature: ["Remote"] });
    // If the trap weren't handled, "Remote" would be compared against
    // preferredJobTypes (missing it entirely, since that enum has no
    // "Remote" option) and drag the blended score down to 0.5.
    expect(computeUnifiedScore(job, applicant).breakdown.employmentType).toBe(1);
  });

  test("null: applicant stated no job-type or work-nature preference at all", () => {
    const job = baseJob();
    const applicant = baseApplicant();
    expect("employmentType" in computeUnifiedScore(job, applicant).breakdown).toBe(false);
  });
});

describe("§B.2 employer-side industry scoring (background vs preference)", () => {
  const job = baseJob({ industry: "Finance" });

  test("preference mode (job-board default) is unaffected — a bare stated preference still scores", () => {
    const applicant = baseApplicant({ preferredIndustries: ["finance"] });
    const res = computeUnifiedScore(job, applicant); // industryMode defaults to 'preference'
    expect(res.breakdown.industry).toBe(1);
  });

  test("background mode ignores a bare stated preference with no work/training history", () => {
    const applicant = baseApplicant({ preferredIndustries: ["finance"] });
    const res = computeUnifiedScore(job, applicant, null, undefined, "background");
    expect("industry" in res.breakdown).toBe(false);
  });

  test("background mode scores from matching work history even with no stated preference", () => {
    const applicant = baseApplicant({
      preferredIndustries: [],
      workHistory: [{ companyName: "ABC Finance Corp", position: "Bookkeeper" }],
    });
    const res = computeUnifiedScore(job, applicant, null, undefined, "background");
    expect(res.breakdown.industry).toBeGreaterThan(0);
  });

  test("background mode scores from matching vocational training too", () => {
    const applicant = baseApplicant({
      preferredIndustries: [],
      vocationalTrainings: [{ course: "Finance and Bookkeeping NC II" }],
    });
    const res = computeUnifiedScore(job, applicant, null, undefined, "background");
    expect(res.breakdown.industry).toBeGreaterThan(0);
  });

  test("background mode returns a real (non-null) 0 when background exists but doesn't match", () => {
    const applicant = baseApplicant({
      preferredIndustries: [],
      workHistory: [{ companyName: "Unrelated Retail Store", position: "Cashier" }],
    });
    const job2 = baseJob({ industry: "Aviation" });
    const res = computeUnifiedScore(job2, applicant, null, undefined, "background");
    expect(res.breakdown.industry).toBe(0);
  });

  test("null: job has no industry set, in either mode", () => {
    const jobNoIndustry = baseJob({ industry: "" });
    const applicant = baseApplicant({
      preferredIndustries: ["finance"],
      workHistory: [{ companyName: "ABC Finance Corp", position: "Bookkeeper" }],
    });
    expect("industry" in computeUnifiedScore(jobNoIndustry, applicant, null, undefined, "preference").breakdown).toBe(false);
    expect("industry" in computeUnifiedScore(jobNoIndustry, applicant, null, undefined, "background").breakdown).toBe(false);
  });

  test("null: applicant has no background and no stated preference, in background mode", () => {
    const applicant = baseApplicant();
    const res = computeUnifiedScore(job, applicant, null, undefined, "background");
    expect("industry" in res.breakdown).toBe(false);
  });

  test("rankApplicantsByJob (the employer path) actually uses background mode end-to-end", () => {
    const applicants = [
      {
        _id: "a1",
        user: { _id: "a1", name: "Jane", skills: ["encoding"] },
        profile: { skills: ["encoding"], preferredIndustries: ["finance"], workHistory: [], vocationalTrainings: [] },
      },
    ];
    const result = rankApplicantsByJob(job, applicants, {});
    // Bare preference, no history — background mode must not score this.
    expect(result.items[0].matchBreakdown.industry).toBeUndefined();
  });
});
