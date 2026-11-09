// User schema behavior for email-less jobseekers, plus the two scripts' pure
// parts. No database: validateSync and schema introspection only. The real
// index behavior is a manual check (see the rollout checklist).

const User = require("../models/User");
const { buildFilter } = require("../scripts/migrateEmailVerifiedBackfill");
const { buildPlan, NEW_INDEXES, OLD_INDEX_NAMES } = require("../scripts/swapUserEmailUsernameIndexes");

const make = (fields) => new User({ name: "Juan", password: "x", ...fields });
const errorPaths = (doc) => Object.keys(doc.validateSync()?.errors || {});

describe("User.email / User.username", () => {
  test("a jobseeker with a username may have no email", () => {
    expect(errorPaths(make({ role: "jobseeker", username: "juan_dc" }))).not.toContain("email");
  });

  test("a jobseeker with neither username nor email is invalid", () => {
    expect(errorPaths(make({ role: "jobseeker" }))).toContain("email");
  });

  test.each(["employer", "admin", "superadmin"])("%s still requires an email even with a username", (role) => {
    expect(errorPaths(make({ role, username: "someone" }))).toContain("email");
  });

  test("default role (jobseeker) follows the same rule", () => {
    expect(errorPaths(make({ username: "juan_dc" }))).not.toContain("email");
  });

  test("an empty or whitespace email is discarded, never stored", () => {
    for (const value of ["", "   "]) {
      const doc = make({ role: "jobseeker", username: "juan_dc", email: value });
      expect(doc.email).toBeUndefined();
      expect(doc.toObject()).not.toHaveProperty("email");
    }
  });

  test("an empty username is discarded; the default is absent, not null", () => {
    expect(make({ role: "jobseeker", email: "a@b.co", username: "" }).username).toBeUndefined();
    const plain = make({ role: "jobseeker", email: "a@b.co" });
    expect(plain.username).toBeUndefined();
    expect("username" in plain.toObject()).toBe(false);
  });

  test("email is still trimmed and lowercased", () => {
    expect(make({ email: "  Juan@Example.COM " }).email).toBe("juan@example.com");
  });

  test("an unverified account (isEmailVerified false) is not given an email by the model", () => {
    expect(make({ role: "jobseeker", username: "juan_dc" }).isEmailVerified).toBeUndefined();
  });
});

describe("User indexes", () => {
  const indexes = User.schema.indexes();
  const byName = (name) => indexes.find(([, opts]) => opts.name === name);

  test("email: one partial, case-insensitive unique index; no field-level unique", () => {
    const [key, opts] = byName("email_unique_ci");
    expect(key).toEqual({ email: 1 });
    expect(opts.unique).toBe(true);
    expect(opts.collation).toEqual({ locale: "en", strength: 2 });
    expect(opts.partialFilterExpression).toEqual({ email: { $type: "string" } });
    expect(User.schema.path("email").options.unique).toBeUndefined();
    expect(indexes.filter(([k]) => Object.keys(k).join() === "email")).toHaveLength(1);
  });

  test("username: partial, not sparse", () => {
    const [, opts] = byName("username_unique_ci");
    expect(opts.partialFilterExpression).toEqual({ username: { $type: "string" } });
    expect(opts.sparse).toBeUndefined();
    expect(opts.collation).toEqual({ locale: "en", strength: 2 });
  });
});

describe("scripts (pure parts only; never run against a database here)", () => {
  test("backfill filter cannot match an email-less or empty-email account", () => {
    expect(buildFilter()).toEqual({
      isEmailVerified: { $exists: false },
      email: { $exists: true, $type: "string", $ne: "" },
    });
  });

  test("index swap plan drops the three old indexes and creates the two partial ones", () => {
    const plan = buildPlan();
    expect(plan.dropIndexes).toEqual(OLD_INDEX_NAMES);
    expect(plan.dropIndexes).toEqual(expect.arrayContaining(["email_1", "email_unique_ci", "username_unique_ci"]));
    expect(plan.createIndexes).toBe(NEW_INDEXES);
    for (const { options } of NEW_INDEXES) {
      expect(options.unique).toBe(true);
      expect(options.collation).toEqual({ locale: "en", strength: 2 });
      expect(Object.keys(options.partialFilterExpression)).toHaveLength(1);
    }
    expect(plan.unsetExplicitNullUsername.update).toEqual({ $unset: { username: "" } });
  });

  test("the model indexes and the script's new indexes agree", () => {
    const model = User.schema.indexes().map(([k, o]) => ({ key: k, options: o }));
    for (const spec of NEW_INDEXES) {
      const match = model.find((m) => m.options.name === spec.options.name);
      expect(match.key).toEqual(spec.key);
      expect(match.options.partialFilterExpression).toEqual(spec.options.partialFilterExpression);
      expect(match.options.collation).toEqual(spec.options.collation);
    }
  });
});
