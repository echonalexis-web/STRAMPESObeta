const { formats, numberFormatValid, getFormat } = require("../data/governmentIdFormats");
const { parseIdText } = require("../utils/idOcrParser");
const examples = [
  ["Driver's License", "A01-23-456789", "DRIVER'S LICENSE"],
  ["Passport", "P1234567A", "PASSPORT"],
  ["Philippine National ID", "1234-5678-9012-3456", "PHILSYS"],
  ["SSS ID", "12-3456789-0", "SOCIAL SECURITY SYSTEM"],
  ["UMID", "1234-5678901-2", "UNIFIED MULTI-PURPOSE ID"],
  ["PhilHealth ID", "12-345678901-2", "PHILHEALTH"],
  ["TIN", "123-456-789-000", "TAXPAYER IDENTIFICATION"],
];
test.each(examples)("%s accepts its fixture and rejects malformed numbers", (type, number, title) => {
  expect(numberFormatValid(type, number)).toBe(true);
  expect(numberFormatValid(type, "INVALID")).toBe(false);
  expect(parseIdText(`${title}\n${number}`, { governmentIdType: type }, new Set([type])).extracted).toMatchObject({ idNumber: number, detectedType: type });
});
test("every registered format has a fixture", () => expect(Object.keys(formats).sort()).toEqual(examples.map(([type]) => type).sort()));
test.each(["Other valid government-issued ID", "Voter's ID", "Postal ID", "PRC", "Custom ID", "__proto__", "constructor"])("%s is unchecked rather than rejected", (type) => {
  expect(getFormat(type)).toBeNull(); expect(numberFormatValid(type, "123")).toBeNull();
});
test("both PSN and card-number layouts are accepted", () => expect(numberFormatValid("Philippine National ID", "1234-5678-9012")).toBe(true));
