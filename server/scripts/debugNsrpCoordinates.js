/**
 * Calibration helper for server/services/nsrpFormFieldMaps.js.
 *
 * Fills both NSRP templates with distinctive placeholder text at every
 * mapped coordinate and writes the results next to this script, so they can
 * be opened in any local PDF viewer to check whether each field lands
 * inside its printed box on the real template.
 *
 * Workflow:
 *   1. node server/scripts/debugNsrpCoordinates.js
 *   2. Open server/scripts/debug-output/NSRP-Form-1-debug.pdf (and -2-) in a
 *      PDF viewer.
 *   3. For every field that's misaligned, adjust its {x, y} in
 *      nsrpFormFieldMaps.js (pdf-lib's origin is the page's bottom-left
 *      corner, in points) and re-run this script.
 *   4. Repeat until both pages of both forms line up.
 *
 * This script is not wired into any route — it's a standalone dev tool.
 */
const fs = require("fs");
const path = require("path");
const { fillForm1, fillForm2 } = require("../services/nsrpFormService");

const OUTPUT_DIR = path.join(__dirname, "debug-output");

const fixtureUser = {
  firstName: "Juan",
  middleName: "Dela",
  surname: "Cruz",
  suffix: "Jr.",
  name: "Juan Dela Cruz Jr.",
  email: "juan.delacruz@example.com",
  phone: "0917-000-0000",
  gender: "Male",
  dateOfBirth: new Date("1995-05-15"),
  educationalAttainment: "College Graduate",
  companyName: "Sample Trading Corp.",
  industry: "Retail",
  website: "https://sample-trading.example",
  companyDescription: "A sample company description used only for coordinate calibration.",
};

const fixtureJobseekerProfile = {
  civilStatus: "Single",
  placeOfBirth: "Boac, Marinduque",
  citizenship: "Filipino",
  height: 170,
  weight: 65,
  religion: "Roman Catholic",
  tin: "000-000-000",
  sssGsisNo: "00-0000000-0",
  pagibigNo: "0000-0000-0000",
  philhealthNo: "00-000000000-0",
  landline: "(042) 000-0000",
  mobileSecondary: "0918-111-1111",
  presentAddress: { street: "123 Sample St.", barangay: "Poblacion", municipality: "Boac", province: "Marinduque", region: "MIMAROPA" },
  permanentAddress: { street: "456 Other St.", barangay: "San Miguel", municipality: "Santa Cruz", province: "Marinduque", region: "MIMAROPA" },
  is4psBeneficiary: true,
  _4psHouseholdId: "4Ps-0000-1234",
  isOfw: true,
  isRepatriated: true,
  disability: ["Visual"],
  employmentStatus: "unemployed",
  employmentType: "wage",
  unemploymentReason: "fresh_grad",
  preferredOccupations: ["Encoder", "Clerk", "Cashier", "Sales Associate"],
  preferredWorkLocationLocal: ["Boac", "Santa Cruz"],
  preferredWorkLocationOverseas: ["Singapore"],
  expectedSalaryMin: 15000,
  expectedSalaryMax: 20000,
  passportNo: "P1234567",
  passportExpiryDate: new Date("2028-05-01"),
  languageProficiency: {
    English: { read: true, write: true, speak: true, understand: true },
    Filipino: { read: true, write: true, speak: true, understand: true },
    Others: { read: false, write: false, speak: true, understand: true },
  },
  languageOthersLabel: "Tagalog",
  schoolAttended: "Marinduque State College",
  course: "BS Information Technology",
  yearGraduated: "2020",
  vocationalTrainings: [
    { course: "Computer Servicing NC II", institution: "TESDA", durationFrom: "2019-01", durationTo: "2019-03", certificate: "NC II" },
    { course: "Welding NC I", institution: "TESDA", durationFrom: "2018-06", durationTo: "2018-08", certificate: "NC I" },
  ],
  eligibilities: [{ name: "Civil Service Professional", rating: "82.5", examDate: "2021-08-01" }],
  professionalLicenses: [{ name: "Sample License", validUntil: "2027-01-01" }],
  workHistory: [
    { companyName: "Sample Corp.", address: "Boac, Marinduque", position: "Encoder", dateFrom: "2021-01", dateTo: "2022-01", status: "Ended" },
    { companyName: "Other Corp.", address: "Santa Cruz, Marinduque", position: "Clerk", dateFrom: "2020-01", dateTo: "2020-12", status: "Ended" },
  ],
};

const fixtureEmployerProfile = {
  tradeName: "Sample Trading",
  acronym: "STC",
  tin: "000-000-000",
  officeType: "main",
  employerClassification: { type: "private", subtype: "Local Recruitment Agency" },
  totalWorkforceSize: "small",
  businessAddress: { street: "789 Business Ave.", barangay: "Poblacion", municipality: "Boac", province: "Marinduque" },
  ownerName: "Maria Santos",
  contactPersonName: "Pedro Reyes",
  contactPersonPosition: "HR Manager",
  fax: "(042) 111-1111",
};

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const form1Buffer = await fillForm1(fixtureJobseekerProfile, fixtureUser);
  fs.writeFileSync(path.join(OUTPUT_DIR, "NSRP-Form-1-debug.pdf"), form1Buffer);

  const form2Buffer = await fillForm2(fixtureEmployerProfile, fixtureUser);
  fs.writeFileSync(path.join(OUTPUT_DIR, "NSRP-Form-2-debug.pdf"), form2Buffer);

  console.log(`Debug PDFs written to ${OUTPUT_DIR}`);
})().catch((error) => {
  console.error("Failed to generate NSRP debug PDFs:", error);
  process.exitCode = 1;
});
