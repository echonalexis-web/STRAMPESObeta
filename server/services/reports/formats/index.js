// The file formats the generator can write. Each entry: { contentType, extension, render(report) -> Buffer }.
// XLSX and PDF are added by their own modules as they land.
const csv = require("./csv");

const FORMAT_RENDERERS = { csv };

module.exports = { FORMAT_RENDERERS };
