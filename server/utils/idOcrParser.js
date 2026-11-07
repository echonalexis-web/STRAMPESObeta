const { formats, getFormat, numberFormatValid } = require("../data/governmentIdFormats");

const tokens = (name) => new Set(String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z]+/g) || []);
const nameMatchScore = (a, b) => {
  const left = tokens(a), right = tokens(b);
  if (!left.size || !right.size) return null;
  return 2 * [...left].filter((word) => right.has(word)).length / (left.size + right.size);
};

// Parse only unambiguous dates; invalid/calendar-rollover dates stay unknown.
const parseDate = (value) => {
  const text = String(value || "").trim();
  let year, month, day;
  let match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = text.match(/^(\d{1,2})\s+([A-Z]{3,9})\s+(\d{4})$/i) || text.match(/^([A-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i);
    if (!match) return null;
    const monthFirst = /^[A-Z]/i.test(match[1]);
    day = Number(match[monthFirst ? 2 : 1]); year = Number(match[3]);
    month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(match[monthFirst ? 1 : 2].slice(0, 3).toUpperCase()) + 1;
  }
  if (!month || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};

function parseIdText(text, user, activeTypes, now = new Date()) {
  const lines = String(text || "").slice(0, 50000).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const all = lines.join("\n");
  // A match can only name a currently active catalog value.
  const candidates = Object.keys(formats).filter((type) => activeTypes.has(type));
  // UMID cards may also name the SSS issuing agency. Prefer the card type.
  candidates.sort((a, b) => Number(b === "UMID") - Number(a === "UMID"));
  const detectedType = candidates.find((type) => getFormat(type)?.keywords.test(all)) || null;
  const format = getFormat(detectedType || user.governmentIdType);
  const numberRegex = format ? new RegExp(`\\b(?:${format.pattern.slice(1, -1)})\\b`, "i") : null;
  const labelValue = (regex) => {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(regex);
      if (match) return (match[1] || lines[i + 1] || "").trim().slice(0, 250) || null;
    }
    return null;
  };
  const labelledNumber = labelValue(/^(?:ID (?:NUMBER|NO\.?)|PASSPORT (?:NUMBER|NO\.?)|LICENSE (?:NUMBER|NO\.?)|PCN|PSN|CRN|SSS (?:NUMBER|NO\.?)|TIN|PHILHEALTH (?:NUMBER|NO\.?))\s*[:.]?\s*(.*)$/i);
  const idNumber = labelledNumber?.slice(0, 80).toUpperCase() || (numberRegex ? all.match(numberRegex)?.[0]?.toUpperCase() || null : null);
  const fullName = labelValue(/^(?:FULL NAME|NAME|PANGALAN)\s*[:.]?\s*(.*)$/i) || [
    labelValue(/^(?:GIVEN NAMES?|FIRST NAME)\s*[:.]?\s*(.*)$/i),
    labelValue(/^MIDDLE NAME\s*[:.]?\s*(.*)$/i),
    labelValue(/^(?:SURNAME|LAST NAME|APELYIDO)\s*[:.]?\s*(.*)$/i),
  ].filter(Boolean).join(" ") || null;
  const dateOfBirth = parseDate(labelValue(/^(?:DATE OF BIRTH|BIRTH DATE|DOB|PETSA NG KAPANGANAKAN)\s*[:.]?\s*(.*)$/i));
  const expiryDate = parseDate(labelValue(/^(?:EXPIRY DATE|DATE OF EXPIRY|EXPIRATION DATE|VALID UNTIL)\s*[:.]?\s*(.*)$/i));
  const expectedDob = user.dateOfBirth ? new Date(user.dateOfBirth) : null;
  return {
    extracted: { idNumber, fullName, dateOfBirth, detectedType, expiryDate, address: labelValue(/^(?:ADDRESS|TIRAHAN)\s*[:.]?\s*(.*)$/i) },
    checks: {
      numberFormatValid: numberFormatValid(detectedType || user.governmentIdType, idNumber),
      nameMatchScore: nameMatchScore(fullName, user.name || [user.firstName, user.middleName, user.surname].filter(Boolean).join(" ")),
      dobMatch: dateOfBirth && expectedDob && !isNaN(expectedDob) ? dateOfBirth.toISOString().slice(0, 10) === expectedDob.toISOString().slice(0, 10) : null,
      typeMatchesDeclared: detectedType && user.governmentIdType ? detectedType === user.governmentIdType : null,
      expired: expiryDate ? expiryDate.toISOString().slice(0, 10) < now.toISOString().slice(0, 10) : null,
    },
  };
}

module.exports = { parseIdText, parseDate, nameMatchScore };
