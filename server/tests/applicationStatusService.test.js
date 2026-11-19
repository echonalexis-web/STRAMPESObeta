// The one status helper: statusUpdatedAt, hiredAt and firstResponseAt on every transition.

const { setApplicationStatus, reactivationFields } = require("../services/applicationStatusService");

const T1 = new Date("2026-03-01T01:00:00Z");
const T2 = new Date("2026-03-05T02:00:00Z");
const T3 = new Date("2026-03-09T03:00:00Z");
const fresh = (status = "pending") => ({ status, statusUpdatedAt: null, hiredAt: null, hiredAtApproximate: false, firstResponseAt: null });

describe("setApplicationStatus", () => {
  test("always sets the status and the last-change date", () => {
    const app = setApplicationStatus(fresh(), "under_review", { now: T1 });
    expect(app.status).toBe("under_review");
    expect(app.statusUpdatedAt).toBe(T1);
  });

  test("the first move out of pending sets firstResponseAt, once", () => {
    const app = fresh();
    setApplicationStatus(app, "under_review", { now: T1 });
    expect(app.firstResponseAt).toBe(T1);
    setApplicationStatus(app, "shortlisted", { now: T2 });
    expect(app.firstResponseAt).toBe(T1); // not overwritten
    expect(app.statusUpdatedAt).toBe(T2);
  });

  test.each(["under_review", "shortlisted", "approved", "rejected", "hired"])("pending to %s counts as a response", (status) => {
    expect(setApplicationStatus(fresh(), status, { now: T1 }).firstResponseAt).toBe(T1);
  });

  test("withdrawing is the applicant's act, not an employer response", () => {
    const app = setApplicationStatus(fresh(), "withdrawn", { now: T1 });
    expect(app.firstResponseAt).toBeNull();
    expect(app.statusUpdatedAt).toBe(T1);
  });

  test("a legacy Applied status counts as pending", () => {
    const app = setApplicationStatus(fresh("Applied"), "rejected", { now: T1 });
    expect(app.firstResponseAt).toBe(T1);
  });

  test("hired sets hiredAt on the transition and a re-save of hired keeps the first date", () => {
    const app = setApplicationStatus(fresh("shortlisted"), "hired", { now: T1 });
    expect(app.hiredAt).toBe(T1);
    expect(app.hiredAtApproximate).toBe(false);
    setApplicationStatus(app, "hired", { now: T2 });
    expect(app.hiredAt).toBe(T1);
    expect(app.statusUpdatedAt).toBe(T2);
  });

  test("undoing a hire clears the hire date; hiring again sets a new one", () => {
    const app = setApplicationStatus(fresh("approved"), "hired", { now: T1 });
    setApplicationStatus(app, "pending", { now: T2 });
    expect(app.hiredAt).toBeNull();
    setApplicationStatus(app, "hired", { now: T3 });
    expect(app.hiredAt).toBe(T3);
  });

  test("a backfilled approximate hire date is replaced by a real one if the hire is redone", () => {
    const app = { ...fresh("hired"), hiredAt: T1, hiredAtApproximate: true };
    setApplicationStatus(app, "rejected", { now: T2 });
    expect(app.hiredAt).toBeNull();
    expect(app.hiredAtApproximate).toBe(false);
    setApplicationStatus(app, "hired", { now: T3 });
    expect(app.hiredAt).toBe(T3);
    expect(app.hiredAtApproximate).toBe(false);
  });

  test("a legacy Accepted status counts as hired", () => {
    const app = setApplicationStatus(fresh("pending"), "Accepted", { now: T1 });
    expect(app.hiredAt).toBe(T1);
  });

  test("defaults to the current time", () => {
    const before = Date.now();
    const app = setApplicationStatus(fresh(), "hired");
    expect(app.statusUpdatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(app.hiredAt).toBe(app.statusUpdatedAt);
  });
});

describe("reactivationFields", () => {
  test("a re-submitted application starts over: pending, no response date, no hire date", () => {
    expect(reactivationFields()).toEqual({
      status: "pending",
      statusUpdatedAt: null,
      hiredAt: null,
      hiredAtApproximate: false,
      firstResponseAt: null,
    });
  });
});
