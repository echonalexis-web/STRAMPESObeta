import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDates, personSections, placeOf } from "./personProfile.js";

test("all three sections show when there is data", () => {
  const out = personSections({
    user: { about: " I weld. ", skills: ["welding"] },
    profile: { skills: ["fitting", "welding"], workHistory: [{ position: "Welder", companyName: "Mart", dateFrom: "2019-01", dateTo: "2021-06" }], presentAddress: { municipality: "Boac", province: "Marinduque" } },
  });
  assert.equal(out.about, "I weld.");
  assert.deepEqual(out.skills, ["welding", "fitting"]);
  assert.deepEqual(out.work, [{ position: "Welder", companyName: "Mart", dateFrom: "2019-01", dateTo: "2021-06" }]);
  assert.equal(out.place, "Boac, Marinduque");
  assert.equal(out.empty, false);
});

test("an empty section is absent, so only the others show", () => {
  const onlySkills = personSections({ user: { skills: ["x"] }, profile: {} });
  assert.equal(onlySkills.about, "");
  assert.deepEqual(onlySkills.work, []);
  assert.equal(onlySkills.empty, false);
  const onlyWork = personSections({ user: { about: "   " }, profile: { workHistory: [{ position: "Clerk" }] } });
  assert.equal(onlyWork.about, "");
  assert.equal(onlyWork.skills.length, 0);
  assert.equal(onlyWork.work.length, 1);
  assert.equal(onlyWork.empty, false);
});

test("all three empty gives the empty case", () => {
  assert.equal(personSections({ user: {}, profile: {} }).empty, true);
  assert.equal(personSections({}).empty, true);
  assert.equal(personSections().empty, true);
  assert.equal(personSections({ user: { about: " ", skills: [null, ""] }, profile: { workHistory: [{ position: "", companyName: "" }, null] } }).empty, true);
});

test("work entries keep only the role, company and dates", () => {
  const out = personSections({ profile: { workHistory: [{ position: "Cashier", companyName: "Shop", address: "Secret St", status: "Terminated", reasonForLeaving: "x" }] } });
  assert.deepEqual(Object.keys(out.work[0]).sort(), ["companyName", "dateFrom", "dateTo", "position"]);
});

test("the place is municipality and province only", () => {
  assert.equal(placeOf({ presentAddress: { street: "12 Rizal", barangay: "Uno", municipality: "Boac", province: "Marinduque", region: "IV" } }), "Boac, Marinduque");
  assert.equal(placeOf({ presentAddress: { municipality: "Boac" } }), "Boac");
  assert.equal(placeOf({ presentAddress: { barangay: "Uno" } }), "");
  assert.equal(placeOf({}), "");
  assert.equal(placeOf(null), "");
});

test("jobDates", () => {
  assert.equal(jobDates({ dateFrom: "2019-06", dateTo: "2021-01" }), "2019-06 to 2021-01");
  assert.equal(jobDates({ dateFrom: "2019-06" }), "2019-06");
  assert.equal(jobDates({}), "");
  assert.equal(jobDates(undefined), "");
});
