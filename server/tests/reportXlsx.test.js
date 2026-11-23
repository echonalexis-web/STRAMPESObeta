// XLSX output: cover sheet, data sheet, hidden meta sheet, text safety and the cap.

jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const ExcelJS = require("exceljs");
const { FORMAT_RENDERERS } = require("../services/reports/formats");
const xlsx = FORMAT_RENDERERS.xlsx;

const report = (overrides = {}) => ({
  meta: {
    title: "Jobs: 2026 Q4 (Oct to Dec)",
    lines: [
      ["Report ID", "RPT-20261120-ABCDEFGH"],
      ["Prepared by", "Maria Santos"],
      ["Role", "admin"],
      ["Office or position", "PESO Manager"],
      ["Generated at", "2026-11-20 14:05 (Asia/Manila)"],
      ["Dataset", "Jobs"],
      ["Period", "2026 Q4 (Oct to Dec)"],
      ["Record count", "2"],
    ],
  },
  columns: [{ key: "title", label: "Title" }, { key: "slots", label: "Slots" }, { key: "employer", label: "Employer" }],
  rows: [
    { title: "Cashier ñ", slots: 3, employer: "Niño's Café" },
    { title: "=HYPERLINK(\"http://x\")", slots: 1, employer: "+63 912" },
  ],
  ...overrides,
});

const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};

describe("xlsx renderer", () => {
  test("is a valid workbook with the cover, data and a hidden meta sheet", async () => {
    const bytes = await xlsx.render(report());
    expect(bytes.slice(0, 2).toString()).toBe("PK");
    const workbook = await load(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Report", "Data", "_meta"]);
    expect(workbook.getWorksheet("_meta").state).toBe("hidden");
    expect(workbook.getWorksheet("Report").state).toBe("visible");
  });

  test("the cover prints who prepared the report, when and how", async () => {
    const cover = (await load(await xlsx.render(report()))).getWorksheet("Report");
    const rows = {};
    cover.eachRow((row) => { rows[row.getCell(1).value] = row.getCell(2).value; });
    expect(rows["Prepared by"]).toBe("Maria Santos");
    expect(rows["Report ID"]).toBe("RPT-20261120-ABCDEFGH");
    expect(rows["Generated at"]).toBe("2026-11-20 14:05 (Asia/Manila)");
    expect(rows["Office or position"]).toBe("PESO Manager");
    expect(cover.getRow(1).getCell(1).value).toBe("Jobs: 2026 Q4 (Oct to Dec)");
  });

  test("the data sheet has a bold frozen header, numbers stay numbers and Filipino letters survive", async () => {
    const data = (await load(await xlsx.render(report()))).getWorksheet("Data");
    expect(data.getRow(1).values.slice(1)).toEqual(["Title", "Slots", "Employer"]);
    expect(data.getRow(1).font.bold).toBe(true);
    expect(data.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(data.getRow(2).getCell(2).value).toBe(3);
    expect(typeof data.getRow(2).getCell(2).value).toBe("number");
    expect(data.getRow(2).getCell(1).value).toBe("Cashier ñ");
    expect(data.getRow(2).getCell(3).value).toBe("Niño's Café");
  });

  test("a cell that could be read as a formula is written as text with a leading apostrophe", async () => {
    const data = (await load(await xlsx.render(report()))).getWorksheet("Data");
    const risky = data.getRow(3).getCell(1);
    expect(risky.value).toBe("'=HYPERLINK(\"http://x\")");
    expect(typeof risky.value).toBe("string");
    expect(risky.formula).toBeUndefined();
    expect(data.getRow(3).getCell(3).value).toBe("'+63 912");
  });

  test("the hidden sheet holds the same facts as JSON", async () => {
    const meta = (await load(await xlsx.render(report()))).getWorksheet("_meta");
    const json = JSON.parse(meta.getRow(1).getCell(1).value);
    expect(json).toMatchObject({ schemaVersion: 1, columns: ["title", "slots", "employer"], rows: 2 });
    expect(json.lines.find(([label]) => label === "Report ID")[1]).toBe("RPT-20261120-ABCDEFGH");
  });

  test("an empty report still has its header", async () => {
    const data = (await load(await xlsx.render(report({ rows: [] })))).getWorksheet("Data");
    expect(data.rowCount).toBe(1);
  });

  test("a large report is written (5,000 rows)", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ title: `Job ${i}`, slots: i, employer: "Acme" }));
    const data = (await load(await xlsx.render(report({ rows })))).getWorksheet("Data");
    expect(data.rowCount).toBe(5001);
  });
});
