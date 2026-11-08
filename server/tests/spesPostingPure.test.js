// Pure SPES posting logic: derived apply state, the legacy adapter, the migration
// plan, and the one-application-per-posting indexes. No database.

const {
  APPLY_STATE,
  getApplyState,
  getDisplayStatus,
  getClosedReason,
  applyBlockerCode,
  presentPosting,
  fromAnnouncement,
} = require("../utils/spesPosting");
const { postingFieldsFromAnnouncement, planMigration, INDEX_STEPS } = require("../utils/spesMigration");
const { isGuardianRequired } = require("../config/spes");
const SpesApplication = require("../models/SpesApplication");
const SpesPosting = require("../models/SpesPosting");

const NOW = new Date("2026-11-08T04:00:00.000Z");
const day = 86400000;
const posting = (overrides = {}) => ({ status: "published", results: { status: "pending" }, ...overrides });

describe("derived apply state", () => {
  test.each([
    ["a draft is unpublished", { status: "draft" }, APPLY_STATE.UNPUBLISHED, "draft", null, "SPES_PROGRAM_NOT_FOUND"],
    ["an open posting", {}, APPLY_STATE.OPEN, "open", null, null],
    ["before it opens", { opensAt: new Date(NOW.getTime() + day) }, APPLY_STATE.NOT_OPEN, "closed", "notYetOpen", "SPES_NOT_OPEN"],
    ["after the deadline", { applicationDeadline: new Date(NOW.getTime() - day) }, APPLY_STATE.CLOSED_DEADLINE, "closed", "deadline", "SPES_DEADLINE_PASSED"],
    ["closed by staff", { closedAt: new Date(NOW.getTime() - 1000) }, APPLY_STATE.CLOSED_MANUAL, "closed", "manual", "SPES_NOT_OPEN"],
    ["results released", { results: { status: "released" } }, APPLY_STATE.RESULTS_RELEASED, "results_released", "resultsReleased", "SPES_NOT_OPEN"],
    ["archived", { status: "archived" }, APPLY_STATE.UNPUBLISHED, "archived", null, "SPES_PROGRAM_NOT_FOUND"],
  ])("%s", (_label, overrides, state, display, reason, blocker) => {
    const p = posting(overrides);
    expect(getApplyState(p, NOW)).toBe(state);
    expect(getDisplayStatus(p, NOW)).toBe(display);
    expect(getClosedReason(p, NOW)).toBe(reason);
    expect(applyBlockerCode(p, NOW)).toBe(blocker);
  });

  test("the deadline day itself is still open; manual close wins over an open period", () => {
    expect(getApplyState(posting({ applicationDeadline: new Date(NOW.getTime() + 1) }), NOW)).toBe(APPLY_STATE.OPEN);
    const both = posting({ closedAt: new Date(NOW.getTime() - 1), applicationDeadline: new Date(NOW.getTime() + day) });
    expect(getApplyState(both, NOW)).toBe(APPLY_STATE.CLOSED_MANUAL);
  });

  test("presentPosting returns only client-safe fields and the derived values", () => {
    const out = presentPosting(posting({ _id: "p1", title: "T", createdBy: "secret", results: { status: "pending", releasedBy: "admin1" } }), NOW);
    expect(out.applyState).toBe("open");
    expect(out.displayStatus).toBe("open");
    expect(out).not.toHaveProperty("createdBy");
    expect(out.results).not.toHaveProperty("releasedBy");
  });
});

describe("legacy adapter: an announcement with the spes flag behaves like a posting", () => {
  const announcement = (extra = {}) => ({
    _id: "a1",
    title: "SPES 2026",
    content: "Details",
    imageUrl: "x.png",
    isActive: true,
    publishedAt: new Date("2026-09-01"),
    spes: { applicationDeadline: new Date(NOW.getTime() + day), slots: 10, requirements: ["ID"], exposeScores: true },
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  });

  test("maps fields and is marked legacy", () => {
    const p = fromAnnouncement(announcement());
    expect(p).toMatchObject({ _id: "a1", legacy: true, title: "SPES 2026", description: "Details", status: "published", slots: 10 });
    expect(p.results.exposeScores).toBe(true);
    expect(getApplyState(p, NOW)).toBe(APPLY_STATE.OPEN);
  });

  test("an inactive announcement reads as a draft", () => {
    expect(fromAnnouncement(announcement({ isActive: false })).status).toBe("draft");
  });

  test("writes go to the announcement only (close, then release)", async () => {
    const a = announcement();
    const p = fromAnnouncement(a);
    p.closedAt = new Date(NOW);
    await p.save();
    expect(a.spes.closedAt).toEqual(new Date(NOW));
    expect(a.save).toHaveBeenCalledTimes(1);

    p.results.status = "released";
    p.results.releasedAt = new Date(NOW);
    p.results.releasedBy = "admin1";
    await p.save();
    expect(a.spes.resultsStatus).toBe("published");
    expect(a.spes.resultsPublishedBy).toBe("admin1");
  });
});

describe("guardian rule: global flag with a per-posting override", () => {
  test("null uses the default (required); true and false override it", () => {
    expect(isGuardianRequired({ guardianRequired: null })).toBe(true);
    expect(isGuardianRequired({})).toBe(true);
    expect(isGuardianRequired({ guardianRequired: false })).toBe(false);
    expect(isGuardianRequired({ guardianRequired: true })).toBe(true);
  });
});

describe("migration plan", () => {
  const legacy = (id, extra = {}) => ({
    _id: id,
    title: `SPES ${id}`,
    content: "c",
    isActive: true,
    author: "u1",
    spes: { applicationDeadline: new Date(NOW.getTime() + day), resultsStatus: "published", resultsSummary: "done", exposeScores: true },
    ...extra,
  });

  test("copies every setting including the results state and links back", () => {
    const f = postingFieldsFromAnnouncement(legacy("a1"));
    expect(f).toMatchObject({ title: "SPES a1", status: "published", legacyAnnouncementId: "a1", newsAnnouncementId: "a1", guardianRequired: null });
    expect(f.results).toMatchObject({ status: "released", summary: "done", exposeScores: true });
    expect(postingFieldsFromAnnouncement(legacy("a2", { isActive: false })).status).toBe("draft");
  });

  test("is idempotent: announcements that already have a posting are skipped", () => {
    const plan = planMigration([legacy("a1"), legacy("a2")], new Set(["a1"]));
    expect(plan.toCreate.map((x) => x.announcementId)).toEqual(["a2"]);
    expect(plan.skipped).toEqual(["a1"]);
    expect(planMigration([legacy("a1")], new Set(["a1"])).toCreate).toHaveLength(0);
  });

  test("swaps the old plain unique index for two partial ones", () => {
    expect(INDEX_STEPS[0]).toMatchObject({ action: "dropIndex", name: "applicant_1_announcement_1" });
    const created = INDEX_STEPS.filter((s) => s.action === "createIndex");
    expect(created.map((s) => Object.keys(s.keys).join("+"))).toEqual(["applicant+announcement", "applicant+posting"]);
    created.forEach((s) => {
      expect(s.options.unique).toBe(true);
      expect(s.options.partialFilterExpression).toBeDefined();
    });
  });
});

describe("one application per posting (partial unique indexes)", () => {
  const indexes = SpesApplication.schema.indexes();
  const find = (keys) => indexes.find(([k]) => JSON.stringify(k) === JSON.stringify(keys));

  test("{applicant, posting} is unique and only applies when posting is set", () => {
    const [, options] = find({ applicant: 1, posting: 1 });
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ posting: { $type: "objectId" } });
  });

  test("{applicant, announcement} is unique and partial, so a native posting (no announcement) does not collide on null", () => {
    const [, options] = find({ applicant: 1, announcement: 1 });
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ announcement: { $type: "objectId" } });
  });

  test("announcement is no longer required; posting is optional too (legacy rows)", () => {
    expect(SpesApplication.schema.path("announcement").isRequired).toBeFalsy();
    expect(SpesApplication.schema.path("posting").isRequired).toBeFalsy();
  });

  test("the posting's legacyAnnouncementId index is partial too", () => {
    const [, options] = SpesPosting.schema.indexes().find(([k]) => k.legacyAnnouncementId);
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ legacyAnnouncementId: { $type: "objectId" } });
  });

  test("status values people see map to the stored model (draft, published, archived)", () => {
    expect(SpesPosting.schema.path("status").enumValues).toEqual(["draft", "published", "archived"]);
  });
});
