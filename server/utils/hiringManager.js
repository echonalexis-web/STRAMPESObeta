// The optional "Hiring manager name" of a vacancy: plain text only. Control characters and
// angle brackets are dropped, spaces collapsed, and the length capped, so what is stored can be
// placed in a letter or a PDF as text. (HTML output still escapes it where it renders.)

const HIRING_MANAGER_NAME_MAX = 80;

const cleanHiringManagerName = (value) =>
  String(value == null ? "" : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HIRING_MANAGER_NAME_MAX)
    .trim();

module.exports = { cleanHiringManagerName, HIRING_MANAGER_NAME_MAX };
