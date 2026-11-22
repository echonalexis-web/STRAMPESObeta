import test from "node:test";
import assert from "node:assert/strict";
import { arrowState, carouselModel, employerName, postedAgo, salaryAsPosted, visibleRange } from "./homeJobs.js";

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ _id: String(i) }));

test("more than 4 jobs: the 4 newest plus a See more card that counts the rest", () => {
  const m = carouselModel(jobs(4), 9);
  assert.deepEqual({ shown: m.jobs.length, hasMore: m.hasMore, moreCount: m.moreCount, slideCount: m.slideCount, total: m.total }, { shown: 4, hasMore: true, moreCount: 5, slideCount: 5, total: 9 });
});

test("4 or fewer: no See more card, and zero is zero", () => {
  assert.equal(carouselModel(jobs(4), 4).hasMore, false);
  assert.equal(carouselModel(jobs(4), 4).slideCount, 4);
  assert.equal(carouselModel(jobs(2), 2).slideCount, 2);
  const none = carouselModel([], 0);
  assert.deepEqual({ shown: none.jobs.length, total: none.total, slideCount: none.slideCount }, { shown: 0, total: 0, slideCount: 0 });
  assert.equal(carouselModel(undefined, undefined).total, 0);
});

test("never shows more than 4 jobs even if the server sends more", () => {
  assert.equal(carouselModel(jobs(9), 9).jobs.length, 4);
  assert.equal(carouselModel(jobs(9), 9).moreCount, 5);
});

test("position label: slide numbers for the visible window", () => {
  assert.deepEqual(visibleRange({ scrollLeft: 0, clientWidth: 900, step: 300, slideCount: 5 }), { from: 1, to: 3 });
  assert.deepEqual(visibleRange({ scrollLeft: 600, clientWidth: 900, step: 300, slideCount: 5 }), { from: 3, to: 5 });
  assert.deepEqual(visibleRange({ scrollLeft: 0, clientWidth: 262, step: 278, slideCount: 5 }), { from: 1, to: 1 });
  assert.deepEqual(visibleRange({ scrollLeft: 99999, clientWidth: 262, step: 278, slideCount: 5 }), { from: 5, to: 5 });
  assert.deepEqual(visibleRange({ slideCount: 0 }), { from: 0, to: 0 });
});

test("arrows disable at both ends (1px tolerance)", () => {
  assert.deepEqual(arrowState({ scrollLeft: 0, clientWidth: 900, scrollWidth: 1500 }), { canPrev: false, canNext: true });
  assert.deepEqual(arrowState({ scrollLeft: 300, clientWidth: 900, scrollWidth: 1500 }), { canPrev: true, canNext: true });
  assert.deepEqual(arrowState({ scrollLeft: 600, clientWidth: 900, scrollWidth: 1500 }), { canPrev: true, canNext: false });
  assert.deepEqual(arrowState({ scrollLeft: 599.5, clientWidth: 900, scrollWidth: 1500 }), { canPrev: true, canNext: false });
  assert.deepEqual(arrowState({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }), { canPrev: false, canNext: false });
});

test("employer name: company name, then business name, then a neutral label, never the bare word Employer", () => {
  assert.equal(employerName({ employer: { companyName: "Acme" } }, "Hiring employer"), "Acme");
  assert.equal(employerName({ employer: { companyName: " ", tradeName: "Acme Trading" } }, "Hiring employer"), "Acme Trading");
  assert.equal(employerName({ employer: { companyName: "" } }, "Hiring employer"), "Hiring employer");
  assert.equal(employerName({}, "Hiring employer"), "Hiring employer");
});

test("salary as posted, and a relative posted date", () => {
  assert.equal(salaryAsPosted("PHP 20,000"), "PHP 20,000");
  assert.equal(salaryAsPosted("15000"), "₱15000");
  assert.equal(salaryAsPosted(""), null);
  const now = Date.UTC(2026, 10, 23);
  assert.equal(postedAgo(new Date(now - 2 * 86400000).toISOString(), now), "2d ago");
  assert.equal(postedAgo(new Date(now - 40 * 86400000).toISOString(), now), "1mo ago");
  assert.equal(postedAgo(null, now), null);
});
