// Renders a report to PDF in a plain Node process and writes the bytes to stdout as base64.
// Jest cannot load pdfmake (its fontkit dependency is an ES module), so the PDF tests run the
// renderer here, exactly as production does. Input on stdin: { report, options }.
const { render } = require("../services/reports/formats/pdf");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", async () => {
  try {
    const { report, options } = JSON.parse(input);
    const bytes = await render(report, options);
    process.stdout.write(bytes.toString("base64"));
  } catch (error) {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exit(1);
  }
});
