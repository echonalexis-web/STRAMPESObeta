// OCR hints, not proof of identity. Unknown/custom catalog values are unchecked.
// National ID cards may show the 16-digit card number rather than the PSN.
const formats = {
  "Driver's License": { pattern: "^[A-Z]\\d{2}-\\d{2}-\\d{6}$", hint: "A01-23-456789", keywords: /LAND TRANSPORTATION|DRIVER.?S LICEN[CS]E/i },
  Passport: { pattern: "^[A-Z]{1,2}\\d{7}[A-Z]?$", hint: "P1234567A", keywords: /PASSPORT|PASAPORTE/i },
  "Philippine National ID": { pattern: "^(?:\\d{4}-\\d{4}-\\d{4}-\\d{4}|\\d{4}-\\d{4}-\\d{4})$", hint: "1234-5678-9012-3456 / 1234-5678-9012", keywords: /PHILSYS|PHILIPPINE IDENTIFICATION|PAMBANSANG PAGKAKAKILANLAN/i },
  "SSS ID": { pattern: "^\\d{2}-\\d{7}-\\d$", hint: "12-3456789-0", keywords: /SOCIAL SECURITY|\bSSS\b/i },
  UMID: { pattern: "^\\d{4}-\\d{7}-\\d$", hint: "1234-5678901-2", keywords: /UNIFIED MULTI.?PURPOSE|\bUMID\b|\bCRN\b/i },
  "PhilHealth ID": { pattern: "^\\d{2}-\\d{9}-\\d$", hint: "12-345678901-2", keywords: /PHILHEALTH|PHILIPPINE HEALTH INSURANCE/i },
  TIN: { pattern: "^\\d{3}-\\d{3}-\\d{3}(?:-\\d{3})?$", hint: "123-456-789 / 123-456-789-000", keywords: /TAXPAYER IDENTIFICATION|BUREAU OF INTERNAL REVENUE|\bTIN\b/i },
  // PRC, Postal and Voter's ID layouts vary; do not invent restrictive rules.
};

const getFormat = (type) => Object.prototype.hasOwnProperty.call(formats, type) ? formats[type] : null;
const numberFormatValid = (type, value) => {
  const format = getFormat(type);
  return format && value ? new RegExp(format.pattern).test(String(value).trim().toUpperCase()) : null;
};

module.exports = { formats, getFormat, numberFormatValid };
