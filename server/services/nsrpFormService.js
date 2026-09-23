const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fieldMaps = require("./nsrpFormFieldMaps");

const TEMPLATE_DIR = path.join(__dirname, "..", "assets", "templates");
const FORM1_TEMPLATE = path.join(TEMPLATE_DIR, "NSRP-Form-1-Jobseeker-Reg-Form.pdf");
const FORM2_TEMPLATE = path.join(TEMPLATE_DIR, "NSRP-Form-2-Employer-Reg-Form.pdf");

const CHECK_MARK = "X";
const MIN_FONT_SIZE = 6;
const FONT_SHRINK_STEP = 0.5;

// Some JobseekerProfile/EmployerProfile fields have no corresponding box on
// the actual printed NSRP templates (confirmed by extracting every label's
// exact position from the templates' text layer — see
// server/scripts/extractPdfText.mjs): permanentAddress, weight,
// mobileSecondary, isOfw, isRepatriated, repatriationIntent, and
// EmployerProfile.ownerName. These are intentionally not drawn.

const formatDateForForm = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Draws text at a mapped coordinate. When `maxWidth` is set (table cells,
 * address lines, anything that sits directly above another printed row),
 * overflow is handled by shrinking the font in small steps down to
 * `MIN_FONT_SIZE`, then truncating with an ellipsis if it still doesn't
 * fit — never wrapping to a second line, since these fields sit in
 * single-line rows on the template and a wrapped second line would land on
 * top of the row below. Silently does nothing for null/empty values so a
 * sparse profile never throws or prints "undefined".
 */
const drawTextSafe = (page, text, coords, font) => {
  if (!coords || text === null || text === undefined) return;
  const value = String(text).trim();
  if (!value) return;

  const { x, y, size: baseSize, maxWidth, color } = coords;
  const textColor = color || rgb(0, 0, 0);

  if (!maxWidth) {
    page.drawText(value, { x, y, size: baseSize, font, color: textColor });
    return;
  }

  let size = baseSize;
  while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(value, size) > maxWidth) {
    size -= FONT_SHRINK_STEP;
  }

  let renderValue = value;
  if (font.widthOfTextAtSize(renderValue, size) > maxWidth) {
    while (renderValue.length > 1 && font.widthOfTextAtSize(`${renderValue}…`, size) > maxWidth) {
      renderValue = renderValue.slice(0, -1);
    }
    renderValue = `${renderValue}…`;
  }

  page.drawText(renderValue, { x, y, size, font, color: textColor });
};

const drawCheckMark = (page, isChecked, coords, font) => {
  if (!isChecked || !coords) return;
  page.drawText(CHECK_MARK, { x: coords.x, y: coords.y, size: coords.size, font });
};

const drawRows = (page, items, rowCoordsList, getValues, font) => {
  if (!Array.isArray(items) || !Array.isArray(rowCoordsList)) return;
  items.slice(0, rowCoordsList.length).forEach((item, index) => {
    const rowCoords = rowCoordsList[index];
    const values = getValues(item);
    Object.entries(values).forEach(([key, value]) => {
      const x = rowCoords.columns ? rowCoords.columns[key] : rowCoords.x;
      if (x === undefined) return;
      const maxWidth = rowCoords.columnWidths ? rowCoords.columnWidths[key] : rowCoords.maxWidth;
      drawTextSafe(page, value, { x, y: rowCoords.y, size: rowCoords.size || 9, maxWidth }, font);
    });
  });
};

const loadTemplate = async (templatePath) => {
  const bytes = fs.readFileSync(templatePath);
  return PDFDocument.load(bytes);
};

const EDUCATION_ROW_BY_ATTAINMENT = {
  "Elementary Graduate": "elementary",
  "High School Graduate": "secondary",
  "Senior High School Graduate": "secondary",
  "Vocational / TESDA": "tertiary",
  "College Undergraduate": "tertiary",
  "College Graduate": "tertiary",
  "Master's Degree": "graduateStudies",
  Doctorate: "graduateStudies",
};

const UNEMPLOYMENT_REASON_BOX = {
  fresh_grad: "newEntrantBox",
  finished_contract: "finishedContractBox",
  resigned: "resignedBox",
  retired: "retiredBox",
  laidoff_local: "terminatedLocalBox",
  laidoff_abroad: "terminatedAbroadBox",
};

/**
 * Fills NSRP Form I (jobseeker registration) with a JobseekerProfile + User
 * pair and returns the resulting PDF as a Buffer.
 */
async function fillForm1(jobseekerProfile, user) {
  const doc = await loadTemplate(FORM1_TEMPLATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [page1, page2] = doc.getPages();
  const map = fieldMaps.form1;
  const profile = jobseekerProfile || {};
  const p1 = map.page1;

  drawTextSafe(page1, user.surname || user.name, p1.surname, font);
  drawTextSafe(page1, user.firstName, p1.firstName, font);
  drawTextSafe(page1, user.middleName, p1.middleName, font);
  drawTextSafe(page1, user.suffix, p1.suffix, font);

  drawTextSafe(page1, formatDateForForm(user.dateOfBirth), p1.dateOfBirth, font);
  drawTextSafe(page1, profile.placeOfBirth, p1.placeOfBirth, font);
  drawCheckMark(page1, user.gender === "Male", p1.sexMaleBox, font);
  drawCheckMark(page1, user.gender === "Female", p1.sexFemaleBox, font);
  drawTextSafe(page1, profile.religion, p1.religion, font);

  const presentAddress = profile.presentAddress || {};
  drawTextSafe(page1, presentAddress.street, p1.presentStreet, font);
  drawTextSafe(page1, presentAddress.barangay, p1.presentBarangay, font);
  drawTextSafe(page1, presentAddress.municipality, p1.presentMunicipality, font);
  drawTextSafe(page1, presentAddress.province, p1.presentProvince, font);

  drawCheckMark(page1, profile.civilStatus === "Single", p1.civilSingleBox, font);
  drawCheckMark(page1, profile.civilStatus === "Separated", p1.civilSeparatedBox, font);
  drawCheckMark(page1, profile.civilStatus === "Married", p1.civilMarriedBox, font);
  drawCheckMark(page1, profile.civilStatus === "Live-in", p1.civilLiveInBox, font);
  drawCheckMark(page1, profile.civilStatus === "Widowed", p1.civilWidowedBox, font);

  drawTextSafe(page1, profile.tin, p1.tin, font);
  drawTextSafe(page1, profile.height ? `${profile.height} cm` : "", p1.height, font);
  drawTextSafe(page1, profile.sssGsisNo, p1.sssGsisNo, font);
  drawTextSafe(page1, user.email, p1.email, font);
  drawTextSafe(page1, profile.pagibigNo, p1.pagibigNo, font);
  drawTextSafe(page1, profile.landline, p1.landline, font);
  drawTextSafe(page1, profile.philhealthNo, p1.philhealthNo, font);
  drawTextSafe(page1, user.phone, p1.mobile, font);

  const disability = Array.isArray(profile.disability) ? profile.disability : [];
  drawCheckMark(page1, disability.includes("Visual"), p1.disabilityVisualBox, font);
  drawCheckMark(page1, disability.includes("Hearing"), p1.disabilityHearingBox, font);
  drawCheckMark(page1, disability.includes("Speech"), p1.disabilitySpeechBox, font);
  drawCheckMark(page1, disability.includes("Physical"), p1.disabilityPhysicalBox, font);
  drawCheckMark(page1, disability.includes("Others"), p1.disabilityOthersBox, font);

  drawCheckMark(page1, profile.employmentStatus === "employed", p1.employedBox, font);
  drawCheckMark(page1, profile.employmentStatus === "unemployed", p1.unemployedBox, font);
  drawCheckMark(page1, profile.employmentType === "wage", p1.wageEmployedBox, font);
  drawCheckMark(page1, profile.employmentType === "self", p1.selfEmployedBox, font);
  const reasonBoxKey = UNEMPLOYMENT_REASON_BOX[profile.unemploymentReason];
  if (reasonBoxKey) drawCheckMark(page1, true, p1[reasonBoxKey], font);
  if (profile.unemploymentReason === "laidoff_abroad") {
    drawTextSafe(page1, profile.laidoffCountry, p1.laidoffCountry, font);
  }

  drawCheckMark(page1, profile.is4psBeneficiary === true, p1.fourPsYesBox, font);
  drawCheckMark(page1, profile.is4psBeneficiary === false, p1.fourPsNoBox, font);
  if (profile.is4psBeneficiary) drawTextSafe(page1, profile._4psHouseholdId, p1.fourPsHouseholdId, font);

  drawRows(page1, profile.preferredOccupations, p1.preferredOccupationRows, (occupation) => ({ value: occupation }), font);
  drawCheckMark(page1, Array.isArray(profile.preferredWorkLocationLocal) && profile.preferredWorkLocationLocal.length > 0, p1.localWorkBox, font);
  drawRows(page1, profile.preferredWorkLocationLocal, p1.preferredWorkLocationLocalRows, (loc) => ({ value: loc }), font);
  drawCheckMark(page1, Array.isArray(profile.preferredWorkLocationOverseas) && profile.preferredWorkLocationOverseas.length > 0, p1.overseasWorkBox, font);
  drawRows(page1, profile.preferredWorkLocationOverseas, p1.preferredWorkLocationOverseasRows, (loc) => ({ value: loc }), font);

  const salaryRange = profile.expectedSalaryMin || profile.expectedSalaryMax
    ? `PHP ${profile.expectedSalaryMin ?? "-"} - PHP ${profile.expectedSalaryMax ?? "-"}`
    : "";
  drawTextSafe(page1, salaryRange, p1.expectedSalaryRange, font);
  drawTextSafe(page1, profile.passportNo, p1.passportNo, font);
  drawTextSafe(page1, formatDateForForm(profile.passportExpiryDate), p1.passportExpiryDate, font);

  const languageProficiency = profile.languageProficiency || {};
  Object.entries(p1.languageProficiencyRows).forEach(([language, rowCoords]) => {
    const skills = languageProficiency[language] || {};
    Object.entries(rowCoords.columns).forEach(([skill, x]) => {
      drawCheckMark(page1, skills[skill], { x, y: rowCoords.y, size: 8 }, font);
    });
  });
  drawTextSafe(page1, profile.languageOthersLabel, p1.languageOthersLabel, font);

  // ---- Page 2 ----
  const p2 = map.page2;
  const educationRowKey = EDUCATION_ROW_BY_ATTAINMENT[user.educationalAttainment];
  if (educationRowKey && p2.educationRows[educationRowKey]) {
    const row = p2.educationRows[educationRowKey];
    const school = profile.schoolAttended === "Other" ? profile.schoolAttendedOther : profile.schoolAttended;
    drawTextSafe(page2, school, { x: row.columns.school, y: row.y, size: row.size, maxWidth: 160 }, font);
    drawTextSafe(page2, profile.course, { x: row.columns.course, y: row.y, size: row.size, maxWidth: 80 }, font);
    drawTextSafe(page2, profile.yearGraduated, { x: row.columns.yearGraduated, y: row.y, size: row.size, maxWidth: 45 }, font);
  }

  drawRows(page2, profile.vocationalTrainings, p2.vocationalTrainingRows, (training) => ({
    course: training.course,
    duration: [training.durationFrom, training.durationTo].filter(Boolean).join("-"),
    institution: training.institution === "Other" ? training.institutionOther : training.institution,
    certificate: training.certificate,
  }), font);

  drawRows(page2, profile.eligibilities, p2.eligibilityRows, (item) => ({
    name: item.name,
    rating: item.rating,
    examDate: item.examDate,
  }), font);

  drawRows(page2, profile.professionalLicenses, p2.professionalLicenseRows, (item) => ({
    name: item.name,
    validUntil: item.validUntil,
  }), font);

  drawRows(page2, profile.workHistory, p2.workHistoryRows, (item) => ({
    companyName: item.companyName,
    address: item.address,
    position: item.position,
    dates: [item.dateFrom, item.dateTo].filter(Boolean).join(" to "),
    status: item.status,
  }), font);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

const CLASSIFICATION_SUBTYPE_BOX = {
  "Local Recruitment Agency": "localAgencyBox",
  "Overseas Recruitment Agency": "overseasAgencyBox",
  "D.O. 174 Contractor": "subcontractorBox",
};

const WORKFORCE_SIZE_BOX = {
  micro: "microBox",
  small: "smallBox",
  medium: "mediumBox",
  large: "largeBox",
};

/**
 * Fills NSRP Form II page 1 (establishment registration) with an
 * EmployerProfile + User pair and returns the resulting PDF as a Buffer.
 * Page 2 of this template is a per-job-vacancy posting form (Position
 * Title, Salary, Qualification Requirements, etc.) — it has no
 * EmployerProfile/User equivalent, so it is intentionally left blank.
 */
async function fillForm2(employerProfile, user) {
  const doc = await loadTemplate(FORM2_TEMPLATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [page1] = doc.getPages();
  const map = fieldMaps.form2;
  const profile = employerProfile || {};
  const p1 = map.page1;

  drawTextSafe(page1, user.companyName || profile.tradeName, p1.establishmentName, font);
  drawTextSafe(page1, profile.acronym, p1.acronym, font);
  drawTextSafe(page1, profile.tin, p1.tin, font);

  const classificationType = profile.employerClassification?.type;
  drawCheckMark(page1, classificationType === "public", p1.governmentBox, font);
  drawCheckMark(page1, classificationType === "private", p1.privateBox, font);
  const subtypeBoxKey = CLASSIFICATION_SUBTYPE_BOX[profile.employerClassification?.subtype];
  if (subtypeBoxKey) drawCheckMark(page1, true, p1[subtypeBoxKey], font);

  const workforceBoxKey = WORKFORCE_SIZE_BOX[profile.totalWorkforceSize];
  if (workforceBoxKey) drawCheckMark(page1, true, p1[workforceBoxKey], font);

  drawTextSafe(page1, user.industry, p1.industry, font);

  const businessAddress = profile.businessAddress || {};
  drawTextSafe(page1, businessAddress.street, p1.businessStreet, font);
  drawTextSafe(page1, businessAddress.barangay, p1.businessBarangay, font);
  drawTextSafe(page1, businessAddress.municipality, p1.businessMunicipality, font);
  drawTextSafe(page1, businessAddress.province, p1.businessProvince, font);

  drawTextSafe(page1, profile.contactPersonName, p1.contactPersonName, font);
  drawTextSafe(page1, profile.contactPersonPosition, p1.contactPersonPosition, font);
  drawTextSafe(page1, user.phone, p1.telephone, font);
  drawTextSafe(page1, profile.fax, p1.fax, font);
  drawTextSafe(page1, user.email, p1.email, font);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

module.exports = { fillForm1, fillForm2, formatDateForForm };
