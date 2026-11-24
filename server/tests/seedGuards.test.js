// Guard function tests with sample connection strings. No database connection.
const { evaluateGuard, evaluateManifestGuard, parseMongoUri } = require("../scripts/seed/guards");

describe("seed guards: evaluateGuard", () => {
  test("local dev database is allowed", () => {
    const r = evaluateGuard({ nodeEnv: "development", uri: "mongodb://127.0.0.1:27017/strampeso_seed_dev" });
    expect(r.ok).toBe(true);
    expect(r.target).toMatchObject({ db: "strampeso_seed_dev", hosts: ["127.0.0.1"] });
    expect(evaluateGuard({ nodeEnv: undefined, uri: "mongodb://localhost/anything" }).ok).toBe(true);
  });

  test("production env is refused even for a local dev database", () => {
    const r = evaluateGuard({ nodeEnv: "production", uri: "mongodb://localhost:27017/app_dev" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/production/);
  });

  test("remote host with a non-dev database name is refused", () => {
    const r = evaluateGuard({ nodeEnv: "development", uri: "mongodb+srv://user:secret@cluster0.abcde.mongodb.net/strampeso" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not localhost/);
  });

  test("remote host is allowed only when the database name ends with _dev or _test", () => {
    expect(evaluateGuard({ nodeEnv: "development", uri: "mongodb://db.example.net:27017/strampeso_test" }).ok).toBe(true);
    expect(evaluateGuard({ nodeEnv: "development", uri: "mongodb://db.example.net:27017/strampeso_prod" }).ok).toBe(false);
  });

  test("mixed host list with a remote member needs a dev/test database name", () => {
    expect(evaluateGuard({ nodeEnv: "development", uri: "mongodb://localhost:27017,db.example.net:27017/strampeso" }).ok).toBe(false);
  });

  test("missing or malformed connection string is refused", () => {
    expect(evaluateGuard({ nodeEnv: "development", uri: "" }).ok).toBe(false);
    expect(evaluateGuard({ nodeEnv: "development", uri: "http://localhost/x_dev" }).ok).toBe(false);
  });

  test("credentials are masked in the printable target", () => {
    const r = evaluateGuard({ nodeEnv: "development", uri: "mongodb://admin:hunter2@localhost:27017/strampeso_dev?authSource=admin" });
    expect(r.target.masked).toBe("mongodb://***@localhost:27017/strampeso_dev");
    expect(JSON.stringify(r)).not.toMatch(/hunter2|admin:/);
    expect(parseMongoUri("mongodb://localhost/x").masked).toBe("mongodb://localhost/x");
  });
});

describe("seed guards: evaluateManifestGuard", () => {
  test("existing manifest blocks unless forced", () => {
    expect(evaluateManifestGuard({ manifestExists: true, forceNewBatch: false }).ok).toBe(false);
    expect(evaluateManifestGuard({ manifestExists: true, forceNewBatch: true }).ok).toBe(true);
    expect(evaluateManifestGuard({ manifestExists: false, forceNewBatch: false }).ok).toBe(true);
  });
});
