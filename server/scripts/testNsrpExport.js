/**
 * Verification script for the NSRP Form I calibration against the reference
 * file "sample nsrp form 1.pdf" (project root). Fills Form I with a mock
 * profile matching that reference's sample values and writes the result to
 * server/assets/test-output-nsrp1.pdf for visual comparison.
 *
 * Usage: node server/scripts/testNsrpExport.js
 */
const fs = require("fs");
const path = require("path");
const { fillForm1 } = require("../services/nsrpFormService");

const OUTPUT_PATH = path.join(__dirname, "..", "assets", "test-output-nsrp1.pdf");

// Mirrors the values entered in "sample nsrp form 1.pdf" so the two can be
// compared field-for-field.
const mockUser = {
  surname: "Doe",
  firstName: "John",
  middleName: "Milton",
  suffix: "Jr.",
  name: "John Milton Doe Jr.",
  email: "jd123@gmail.com",
  phone: "09123456789",
  gender: "Male",
  dateOfBirth: "2001-01-10",
  educationalAttainment: "College Graduate",
  desiredJobTitle: "Clerk",
};

const mockJobseekerProfile = {
  placeOfBirth: "Boac, Marinduque",
  civilStatus: "Single",
  presentAddress: {
    street: "Kasilag Street",
    barangay: "Tampus",
    municipality: "Boac",
    province: "Marinduque",
  },
  height: `5'8"`,
  tin: "123-456-789",
  sssGsisNo: "34-1234567-8",
  pagibigNo: "1234-5678-9012",
  philhealthNo: "12-345678901-2",
  landline: "09123456789",
  disability: [],
  employmentStatus: "unemployed",
  unemploymentReason: "fresh_grad",
  preferredOccupations: ["Clerk"],
  preferredWorkLocationLocal: ["Lucena City, Quezon"],
  expectedSalaryMin: 15000,
  expectedSalaryMax: 18000,
  languageProficiency: {
    English: { read: true, write: true, speak: true, understand: true },
    Filipino: { read: true, write: true, speak: true, understand: true },
  },
  schoolAttended: "Marinduque State College",
  course: "BS Information Technology",
  yearGraduated: "2020",
  eligibilities: [{ name: "CSE-PPT", rating: "84", examDate: "3/8/2026" }],
  vocationalTrainings: [],
  professionalLicenses: [],
  workHistory: [],
};

(async () => {
  const buffer = await fillForm1(mockJobseekerProfile, mockUser);
  fs.writeFileSync(OUTPUT_PATH, buffer);
  console.log(`Wrote ${OUTPUT_PATH}`);
})().catch((error) => {
  console.error("Failed to generate test NSRP export:", error);
  process.exitCode = 1;
});
