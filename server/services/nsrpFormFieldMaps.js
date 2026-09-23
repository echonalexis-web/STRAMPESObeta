/**
 * Coordinate map for overlaying profile data onto the official NSRP Form I
 * (jobseeker) and Form II (employer) PDF templates in server/assets/templates.
 *
 * Neither template is a fillable AcroForm — both are plain vector/text layout
 * PDFs — so every field is positioned with pdf-lib's `page.drawText(text, {x, y})`
 * rather than a form-field API. pdf-lib's coordinate origin is the BOTTOM-LEFT
 * corner of the page, in PDF points (1/72 inch), matching `page.getSize()`.
 *
 * Form I's coordinates were calibrated against a reference file, "sample
 * nsrp form 1.pdf" (project root), that a reviewer filled in with sample
 * values at the exact intended positions. Every coordinate below with sample
 * ground truth was read directly from that file's text layer (via
 * `pdfjs-dist`'s `page.getTextContent()` — see server/scripts/extractPdfText.mjs)
 * rather than estimated, so it reproduces that reference exactly. A few
 * fields the sample left blank (Religion, "Actively looking for work",
 * overseas work location, vocational trainings, professional license,
 * work history) have no ground truth to check against; those keep their
 * earlier label-derived estimates, flagged below.
 *
 * NOTE on the Date of Birth field: the actual template prints a single
 * blank cell labeled "DATE OF BIRTH (mm/dd/yyyy)" — there is no per-character
 * grid of boxes on this template (confirmed both by inspecting the blank
 * template's text layer and by the reference file, which fills it with one
 * plain string "1/10/2001" at a single x/y). It's filled as one free-text
 * field accordingly, not a character grid.
 *
 * Repeating sections (Education, Vocational Training, Eligibility/License,
 * Work History) are generated from a baseline Y plus a fixed row-height
 * delta via `buildRows()`/`buildSimpleRows()` below, rather than listing
 * every row's coordinates by hand.
 *
 * Recalibration workflow if the template or reference file ever changes:
 *   1. node server/scripts/extractPdfText.mjs <file.pdf> <pageNum>
 *      — dumps every label's (or filled value's) exact x/y/width.
 *   2. node server/scripts/testNsrpExport.js — fills Form I with a mock
 *      profile and writes server/assets/test-output-nsrp1.pdf.
 *   3. node server/scripts/renderPdfToPng.mjs <file.pdf> <outDir> — renders
 *      to PNG (no poppler/pdftoppm needed) for visual inspection.
 *
 * Page sizes: Form I 595.2 x 841.92pt, Form II 595.44 x 841.92pt (both ≈ A4).
 */

const FONT_SIZE = 9;
const SMALL_FONT_SIZE = 8;

/**
 * Builds `count` row coordinate objects, each sharing the same `columns`
 * map, starting at `baseY` and stepping by `deltaY` (negative — PDF y grows
 * upward, and rows read top-to-bottom) per row.
 */
const buildRows = (baseY, deltaY, count, columns, size = SMALL_FONT_SIZE, columnWidths) =>
  Array.from({ length: count }, (_, i) => ({ y: baseY + i * deltaY, columns, size, columnWidths }));

/** Same idea as buildRows, for single-value-per-row lists (e.g. a numbered list). */
const buildSimpleRows = (baseY, deltaY, count, x, size = SMALL_FONT_SIZE, maxWidth) =>
  Array.from({ length: count }, (_, i) => ({ x, y: baseY + i * deltaY, size, maxWidth }));

module.exports = {
  form1: {
    page1: {
      // ---- Name (written on the blank line above the label row) ----
      surname: { x: 42, y: 683, size: FONT_SIZE },
      firstName: { x: 179, y: 683, size: FONT_SIZE },
      middleName: { x: 312, y: 684, size: FONT_SIZE },
      suffix: { x: 456, y: 683, size: FONT_SIZE },

      // ---- Personal identity ----
      // Single free-text cell — see file header note on Date of Birth.
      dateOfBirth: { x: 218, y: 653, size: FONT_SIZE },
      placeOfBirth: { x: 421, y: 652, size: FONT_SIZE, maxWidth: 130, singleLine: true },
      sexMaleBox: { x: 176, y: 641, size: FONT_SIZE },
      sexFemaleBox: { x: 248, y: 641, size: FONT_SIZE },
      // No sample value for Religion — kept as a label-derived estimate.
      religion: { x: 85, y: 624.9, size: FONT_SIZE, maxWidth: 225, singleLine: true },

      // ---- Present address (right column) — all four sub-fields share the
      // same x in the reference file, one row-height apart. ----
      presentStreet: { x: 429, y: 621, size: SMALL_FONT_SIZE, maxWidth: 145, singleLine: true },
      presentBarangay: { x: 429, y: 603, size: SMALL_FONT_SIZE, maxWidth: 145, singleLine: true },
      presentMunicipality: { x: 429, y: 589, size: SMALL_FONT_SIZE, maxWidth: 145, singleLine: true },
      presentProvince: { x: 429, y: 575, size: SMALL_FONT_SIZE, maxWidth: 145, singleLine: true },

      // ---- Civil status checkboxes ----
      civilSingleBox: { x: 105, y: 603, size: FONT_SIZE },
      civilSeparatedBox: { x: 200, y: 603, size: FONT_SIZE },
      civilMarriedBox: { x: 105, y: 589.1, size: FONT_SIZE },
      civilLiveInBox: { x: 200, y: 589.1, size: FONT_SIZE },
      civilWidowedBox: { x: 105, y: 575.2, size: FONT_SIZE },

      // ---- Government IDs / contact — left-column values share x=143,
      // right-column values share x=452, one row-height apart. ----
      tin: { x: 143, y: 561, size: FONT_SIZE, maxWidth: 165, singleLine: true },
      height: { x: 452, y: 561, size: FONT_SIZE, maxWidth: 60, singleLine: true },
      sssGsisNo: { x: 143, y: 546, size: FONT_SIZE, maxWidth: 165, singleLine: true },
      email: { x: 452, y: 547, size: SMALL_FONT_SIZE, maxWidth: 100, singleLine: true },
      pagibigNo: { x: 143, y: 532, size: FONT_SIZE, maxWidth: 165, singleLine: true },
      landline: { x: 452, y: 532, size: FONT_SIZE, maxWidth: 100, singleLine: true },
      philhealthNo: { x: 143, y: 518, size: FONT_SIZE, maxWidth: 165, singleLine: true },
      mobile: { x: 452, y: 519, size: FONT_SIZE, maxWidth: 100, singleLine: true },

      // ---- Disability checkboxes ----
      disabilityVisualBox: { x: 130, y: 504.4, size: FONT_SIZE },
      disabilitySpeechBox: { x: 209, y: 504.4, size: FONT_SIZE },
      disabilityOthersBox: { x: 284, y: 505, size: FONT_SIZE },
      disabilityOthersLabel: { x: 280, y: 493, size: SMALL_FONT_SIZE, maxWidth: 85, singleLine: true },
      disabilityHearingBox: { x: 131, y: 490.9, size: FONT_SIZE },
      disabilityPhysicalBox: { x: 210, y: 490.9, size: FONT_SIZE },

      // ---- Employment status / type ----
      employedBox: { x: 115, y: 470.3, size: FONT_SIZE },
      unemployedBox: { x: 242, y: 472, size: FONT_SIZE },
      wageEmployedBox: { x: 131, y: 444.8, size: FONT_SIZE },
      newEntrantBox: { x: 258, y: 445, size: FONT_SIZE },
      terminatedLocalBox: { x: 401, y: 444.8, size: FONT_SIZE },
      selfEmployedBox: { x: 131, y: 420.3, size: FONT_SIZE },
      finishedContractBox: { x: 258, y: 422.7, size: FONT_SIZE },
      terminatedAbroadBox: { x: 402, y: 422.7, size: FONT_SIZE },
      laidoffCountry: { x: 500, y: 413.7, size: 7, maxWidth: 20, singleLine: true },
      resignedBox: { x: 258, y: 400.7, size: FONT_SIZE },
      othersReasonBox: { x: 403, y: 389.9, size: FONT_SIZE },
      othersReasonLabel: { x: 490, y: 391.9, size: 7, maxWidth: 25, singleLine: true },
      retiredBox: { x: 258, y: 378.8, size: FONT_SIZE },

      // ---- Actively looking / willing / 4Ps ----
      // No sample mark for "actively looking" — kept as a label-derived estimate.
      activelyLookingYesBox: { x: 190, y: 361, size: FONT_SIZE },
      activelyLookingNoBox: { x: 224, y: 361, size: FONT_SIZE },
      howLongLooking: { x: 430, y: 363, size: SMALL_FONT_SIZE, maxWidth: 65, singleLine: true },
      willingYesBox: { x: 190, y: 350, size: FONT_SIZE },
      willingNoBox: { x: 222, y: 350, size: FONT_SIZE },
      willingIfNoWhen: { x: 355, y: 349.6, size: SMALL_FONT_SIZE, maxWidth: 145, singleLine: true },
      // Sample marks "No" for 4Ps beneficiary; "Yes" box position is a
      // symmetric estimate (label-offset matches every other checkbox here).
      fourPsYesBox: { x: 155, y: 327, size: FONT_SIZE },
      fourPsNoBox: { x: 191, y: 327, size: FONT_SIZE },
      fourPsHouseholdId: { x: 372, y: 327.3, size: SMALL_FONT_SIZE, maxWidth: 100, singleLine: true },

      // ---- Job preference (Section II) ----
      preferredOccupationRows: buildSimpleRows(270, -22, 4, 58, SMALL_FONT_SIZE, 130),
      localWorkBox: { x: 192, y: 278, size: FONT_SIZE },
      preferredWorkLocationLocalRows: buildSimpleRows(247, -22, 3, 231, SMALL_FONT_SIZE, 115),
      overseasWorkBox: { x: 355, y: 276.5, size: FONT_SIZE },
      // No sample value for overseas locations — same row rhythm as local, own column.
      preferredWorkLocationOverseasRows: buildSimpleRows(247, -22, 3, 393, SMALL_FONT_SIZE, 155),

      expectedSalaryRange: { x: 150, y: 186.5, size: SMALL_FONT_SIZE, maxWidth: 105, singleLine: true },
      passportNo: { x: 330, y: 186.5, size: SMALL_FONT_SIZE, maxWidth: 85, singleLine: true },
      passportExpiryDate: { x: 477, y: 186.5, size: SMALL_FONT_SIZE, maxWidth: 55, singleLine: true },

      // ---- Language / dialect proficiency (Section III) ----
      // Column x's and the English/Filipino row y's are sample-confirmed;
      // "Others" has no sample row and keeps the earlier estimate.
      languageProficiencyRows: {
        English: { y: 125, columns: { read: 191, write: 310, speak: 416, understand: 515 } },
        Filipino: { y: 103, columns: { read: 192, write: 310, speak: 417, understand: 514 } },
        Others: { y: 88.2, columns: { read: 192, write: 312, speak: 420, understand: 517 } },
      },
      languageOthersLabel: { x: 75, y: 86.4, size: SMALL_FONT_SIZE, maxWidth: 85, singleLine: true },
    },
    page2: {
      // ---- Section IV: Education. Only ONE row is filled, chosen by
      // nsrpFormService based on educationalAttainment (see EDUCATION_ROW_BY_ATTAINMENT).
      // Row baseline (765) and delta (-23.5) are sample-confirmed from the
      // Elementary/Secondary/Tertiary rows; Graduate Studies has no sample
      // value and follows the same rhythm. ----
      educationRows: (() => {
        const columns = { school: 116, course: 286, yearGraduated: 374 };
        const [elementary, secondary, tertiary, graduateStudies] = buildRows(765, -23.5, 4, columns, 9);
        return { elementary, secondary, tertiary, graduateStudies };
      })(),

      // ---- Section V: Technical/vocational training (3 printed rows).
      // No sample values — row rhythm follows the "1./2./3." label positions
      // from the blank template (638.4, 624.4, 610.5), nudged down slightly
      // to match how every other section's values sit a few points below
      // their row label. ----
      vocationalTrainingRows: buildRows(
        634, -14, 3,
        { course: 65, duration: 252, institution: 355, certificate: 468 },
        SMALL_FONT_SIZE,
        { course: 180, duration: 95, institution: 105, certificate: 115 },
      ),

      // ---- Section VI: Eligibility / professional license (2 rows each).
      // Row baseline/delta are sample-confirmed from the filled eligibility
      // row; professional license shares the same rhythm (own columns). ----
      eligibilityRows: buildRows(
        568.3, -13.9, 2,
        { name: 55, rating: 179, examDate: 231 },
        SMALL_FONT_SIZE,
        { name: 115, rating: 35, examDate: 90 },
      ),
      professionalLicenseRows: buildRows(
        568.3, -13.9, 2,
        { name: 340, validUntil: 501 },
        SMALL_FONT_SIZE,
        { name: 150, validUntil: 90 },
      ),

      // ---- Section VII: Work history. No sample values — row rhythm keeps
      // the spacing verified visually (renderPdfToPng.mjs) to sit clear of
      // the table's row borders. ----
      workHistoryRows: buildRows(
        494, -22, 3,
        { companyName: 40, address: 168, position: 282, dates: 375, status: 475 },
        SMALL_FONT_SIZE,
        { companyName: 120, address: 105, position: 85, dates: 95, status: 80 },
      ),
    },
  },

  form2: {
    page1: {
      establishmentName: { x: 140, y: 622.3, size: FONT_SIZE },
      acronym: { x: 150, y: 601.1, size: FONT_SIZE },
      tin: { x: 165, y: 579.5, size: FONT_SIZE },

      // Employer type / classification checkboxes
      governmentBox: { x: 127.5, y: 559.5, size: FONT_SIZE },
      privateBox: { x: 342.5, y: 559.5, size: FONT_SIZE },
      localAgencyBox: { x: 127.5, y: 546.1, size: FONT_SIZE },
      overseasAgencyBox: { x: 341, y: 546.1, size: FONT_SIZE },
      subcontractorBox: { x: 127.8, y: 532.6, size: FONT_SIZE },

      // Total work force checkboxes
      microBox: { x: 132, y: 511.7, size: FONT_SIZE },
      smallBox: { x: 218.5, y: 511.7, size: FONT_SIZE },
      mediumBox: { x: 314, y: 511.7, size: FONT_SIZE },
      largeBox: { x: 429.2, y: 511.7, size: FONT_SIZE },

      industry: { x: 236, y: 488.5, size: SMALL_FONT_SIZE, maxWidth: 355, singleLine: true },
      businessStreet: { x: 82, y: 466, size: SMALL_FONT_SIZE, maxWidth: 460, singleLine: true },
      businessBarangay: { x: 88, y: 448.9, size: SMALL_FONT_SIZE, maxWidth: 460, singleLine: true },
      businessMunicipality: { x: 125, y: 427.3, size: SMALL_FONT_SIZE, maxWidth: 425, singleLine: true },
      businessProvince: { x: 85, y: 405.7, size: SMALL_FONT_SIZE, maxWidth: 465, singleLine: true },

      contactPersonName: { x: 168, y: 352.9, size: FONT_SIZE },
      contactPersonPosition: { x: 82, y: 331.3, size: FONT_SIZE },
      telephone: { x: 109, y: 309.7, size: FONT_SIZE },
      mobile: { x: 93, y: 288.1, size: FONT_SIZE },
      fax: { x: 76, y: 265.5, size: FONT_SIZE },
      email: { x: 109, y: 243.9, size: SMALL_FONT_SIZE },
    },
    // Page 2 of Form II ("III. VACANCY DETAILS" / "IV. QUALIFICATION
    // REQUIREMENTS" / "V. POSTING DETAILS") is a per-job-vacancy posting
    // form — Position Title, Salary, Qualification Requirements, etc. None
    // of it maps to EmployerProfile/User; it would need a JobVacancy record
    // instead. Deliberately left unmapped until that's scoped.
    page2: {},
  },
};
