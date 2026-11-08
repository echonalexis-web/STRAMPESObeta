// An applicant can open their own SPES documents (and only theirs); staff can
// open any. Ownership is part of the query, so another applicant's ref never matches.

jest.mock("../models/User", () => ({ exists: jest.fn().mockResolvedValue(null) }));
jest.mock("../models/JobApplication", () => ({ exists: jest.fn().mockResolvedValue(null) }));
jest.mock("../models/JobseekerProfile", () => ({ exists: jest.fn().mockResolvedValue(null) }));
jest.mock("../models/EmployerProfile", () => ({ exists: jest.fn().mockResolvedValue(null) }));
jest.mock("../models/JobVacancy", () => ({ find: jest.fn() }));
jest.mock("../models/JobseekerDocument", () => ({ exists: jest.fn().mockResolvedValue(null) }));
jest.mock("../models/SpesApplication", () => ({ exists: jest.fn() }));
jest.mock("../services/storageService", () => ({}));
jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../config/cloudinary", () => ({ SIGNED_URL_TTL_SECONDS: 60 }));

const SpesApplication = require("../models/SpesApplication");
const { canAccessRef } = require("../controllers/fileController");

const REF = "cloudinary:spes/owner/form2.pdf";

beforeEach(() => jest.clearAllMocks());

test("the applicant who owns the application can open the file", async () => {
  SpesApplication.exists.mockImplementation(async (q) => (q.applicant === "owner" && q["documents.fileUrl"] === REF ? { _id: "1" } : null));
  expect(await canAccessRef(REF, { id: "owner", role: "jobseeker" })).toBe(true);
});

test("another applicant cannot open it", async () => {
  SpesApplication.exists.mockImplementation(async (q) => (q.applicant === "owner" ? { _id: "1" } : null));
  expect(await canAccessRef(REF, { id: "someone-else", role: "jobseeker" })).toBe(false);
});

test("an employer cannot open an applicant's SPES document", async () => {
  SpesApplication.exists.mockResolvedValue(null);
  require("../models/JobVacancy").find.mockReturnValue({ distinct: jest.fn().mockResolvedValue([]) });
  expect(await canAccessRef(REF, { id: "boss", role: "employer" })).toBe(false);
});

test("admins and superadmins can open any SPES document without a lookup", async () => {
  expect(await canAccessRef(REF, { id: "a1", role: "admin" })).toBe(true);
  expect(await canAccessRef(REF, { id: "s1", role: "superadmin" })).toBe(true);
  expect(SpesApplication.exists).not.toHaveBeenCalled();
});
