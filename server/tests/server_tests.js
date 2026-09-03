const { buildArchivedJobSnapshot } = require("../controllers/jobController");
const { escapeRegExp, normalizeAdminJobStatus, normalizeMunicipalityLabel } = require("../controllers/adminController");

describe("Server test setup", () => {
  test("Jest is running", () => {
    expect(true).toBe(true);
  });

  test("buildArchivedJobSnapshot keeps safe internal IDs while exposing readable hired candidate names", () => {
    const snapshot = buildArchivedJobSnapshot({
      title: "Senior Dev",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      closedAt: new Date("2025-01-15T00:00:00Z"),
      status: "closed",
      archived: true,
      employer: "employer-1",
      applicationDeadline: new Date("2025-01-20T00:00:00Z"),
    }, {
      totalApplicants: 10,
      qualifiedCount: 4,
      shortlistedCount: 3,
      hiredIds: ["candidate-2", "candidate-8"],
      hiredCandidateNames: ["Jane Dela Cruz", "Mark Santos"],
      archiveReason: "quota_reached",
    });

    expect(snapshot.archiveReason).toBe("quota_reached");
    expect(snapshot.totalApplicants).toBe(10);
    expect(snapshot.qualifiedRate).toBe(40);
    expect(snapshot.shortlistedRate).toBe(30);
    expect(snapshot.hireRate).toBe(20);
    expect(snapshot.hiredCandidateIds).toEqual(["1", "2"]);
    expect(snapshot.hiredCandidateNames).toEqual(["Jane Dela Cruz", "Mark Santos"]);
    expect(snapshot.daysActive).toBe(14);
  });

  test("normalizeAdminJobStatus and normalizeMunicipalityLabel return consistent admin monitoring values", () => {
    expect(normalizeAdminJobStatus("draft")).toBe("pending");
    expect(normalizeAdminJobStatus("active")).toBe("active");
    expect(normalizeAdminJobStatus("closed")).toBe("closed");
    expect(normalizeMunicipalityLabel("santa cruz")).toBe("Santa Cruz");
    expect(normalizeMunicipalityLabel("boac city")).toBe("Boac (Capital)");
    expect(normalizeMunicipalityLabel("other province")).toBe("Other / Outside Marinduque");
  });

  test("municipality regex matching escapes parentheses for Boac (Capital)", () => {
    const municipalityLabel = normalizeMunicipalityLabel("boac city");
    const municipalityRegex = new RegExp(escapeRegExp(municipalityLabel), "i");

    expect(municipalityRegex.test("Boac (Capital)")).toBe(true);
    expect(municipalityRegex.test("Santa Cruz")).toBe(false);
  });

  test("municipality filters accept the canonical UI labels and plain Boac values", () => {
    expect(normalizeMunicipalityLabel("Boac")).toBe("Boac (Capital)");
    expect(normalizeMunicipalityLabel("Other / Outside Province")).toBe("Other / Outside Province");
    expect(normalizeMunicipalityLabel("Other / Outside Marinduque")).toBe("Other / Outside Province");
    expect(/boac|capital/i.test("Boac, Marinduque")).toBe(true);
  });
});
