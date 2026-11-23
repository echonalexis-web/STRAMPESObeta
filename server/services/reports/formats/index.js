// The file formats the generator can write. Each entry: { contentType, extension, render(report) -> Buffer }.
const csv = require("./csv");
const xlsx = require("./xlsx");
const pdf = require("./pdf");

const FORMAT_RENDERERS = { csv, xlsx, pdf };

module.exports = { FORMAT_RENDERERS };
