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

const { fixtureUser, fixtureJobseekerProfile, fixtureEmployerProfile } = require("../services/nsrpSampleData");

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const templateDir = path.join(__dirname, "..", "assets", "templates");
  const form1Buffer = await fillForm1(fixtureJobseekerProfile, fixtureUser,
    fs.readFileSync(path.join(templateDir, "NSRP-Form-1-Jobseeker-Reg-Form.pdf")));
  fs.writeFileSync(path.join(OUTPUT_DIR, "NSRP-Form-1-debug.pdf"), form1Buffer);

  const form2Buffer = await fillForm2(fixtureEmployerProfile, fixtureUser,
    fs.readFileSync(path.join(templateDir, "NSRP-Form-2-Employer-Reg-Form.pdf")));
  fs.writeFileSync(path.join(OUTPUT_DIR, "NSRP-Form-2-debug.pdf"), form2Buffer);

  console.log(`Debug PDFs written to ${OUTPUT_DIR}`);
})().catch((error) => {
  console.error("Failed to generate NSRP debug PDFs:", error);
  process.exitCode = 1;
});
