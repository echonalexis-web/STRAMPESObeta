const { fillForm1, fillForm2 } = require("../services/nsrpFormService");

const fixtureUser = {
  firstName: "Juan",
  middleName: "Dela",
  surname: "Cruz",
  suffix: "",
  name: "Juan Dela Cruz",
  email: "juan.delacruz@example.com",
  phone: "0917-000-0000",
  gender: "Male",
  dateOfBirth: new Date("1995-05-15"),
  educationalAttainment: "College Graduate",
  companyName: "Sample Trading Corp.",
  industry: "Retail",
};

const fixtureJobseekerProfile = {
  civilStatus: "Single",
  placeOfBirth: "Boac, Marinduque",
  presentAddress: { street: "123 Sample St.", barangay: "Poblacion", municipality: "Boac", province: "Marinduque", region: "MIMAROPA" },
  expectedSalaryMin: 15000,
  expectedSalaryMax: 20000,
  preferredOccupations: ["Encoder", "Clerk"],
  languageProficiency: { English: { read: true, write: true, speak: true, understand: true } },
  workHistory: [{ companyName: "Sample Corp.", position: "Encoder", dateFrom: "2021-01", dateTo: "2022-01", status: "Ended" }],
};

const fixtureEmployerProfile = {
  tradeName: "Sample Trading",
  tin: "000-000-000",
  officeType: "main",
  employerClassification: { type: "private", subtype: "Direct Hire" },
  businessAddress: { street: "789 Business Ave.", barangay: "Poblacion", municipality: "Boac", province: "Marinduque" },
  ownerName: "Maria Santos",
};

describe("nsrpFormService", () => {
  test("fillForm1 returns a valid 2-page PDF populated from a jobseeker profile", async () => {
    const buffer = await fillForm1(fixtureJobseekerProfile, fixtureUser);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");

    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(2);
  });

  test("fillForm2 returns a valid 2-page PDF populated from an employer profile", async () => {
    const buffer = await fillForm2(fixtureEmployerProfile, fixtureUser);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");

    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(2);
  });

  test("fillForm1 does not throw on a mostly-empty profile", async () => {
    await expect(fillForm1({}, { name: "No Data User" })).resolves.toBeInstanceOf(Buffer);
  });

  test("fillForm2 does not throw on a mostly-empty profile", async () => {
    await expect(fillForm2({}, { name: "No Data Employer" })).resolves.toBeInstanceOf(Buffer);
  });
});
