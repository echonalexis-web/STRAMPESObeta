// The file formats the generator can write. Each entry: { contentType, extension, render(report) -> Buffer }.
// PDF is added by its own module when it lands.
const csv = require("./csv");
const xlsx = require("./xlsx");

const FORMAT_RENDERERS = { csv, xlsx };

module.exports = { FORMAT_RENDERERS };
