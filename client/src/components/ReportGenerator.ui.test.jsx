import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("./feedback/context", () => ({ useToast: () => toast }));
vi.mock("../utils/exportUtils", () => ({ downloadBlob: vi.fn() }));
vi.mock("../services/api", () => ({
  adminAPI: {
    getReportCatalog: vi.fn(),
    getAnalyticsFilterOptions: vi.fn(),
    previewReportExport: vi.fn(),
    generateReportExport: vi.fn(),
    listReportExports: vi.fn(),
    regenerateReportExport: vi.fn(),
  },
}));

const { adminAPI } = await import("../services/api");
const { downloadBlob } = await import("../utils/exportUtils");
const { default: ReportGeneratorPanel } = await import("./ReportGeneratorPanel");

const col = (key, label, def = false) => ({ key, label, default: def });
const catalog = {
  datasets: [
    { id: "jobs", label: "Jobs", section: "jobs", needsPurpose: false, groupings: ["none", "month"], defaultGrouping: "none", maxRows: { csv: 50000, xlsx: 50000, pdf: 2000 }, columns: [col("title", "Title", true), col("employer", "Employer", true), col("hires", "Hires")] },
    { id: "hires", label: "Hires", section: "jobs", needsPurpose: true, groupings: ["none", "month", "ageBracket"], defaultGrouping: "none", maxRows: { csv: 50000, xlsx: 50000, pdf: 2000 }, columns: [col("hiredAt", "Hire date", true), col("ageBracket", "Applicant age bracket", true)] },
    { id: "employer_ranking", label: "Ranking", section: "jobs", needsPurpose: false, groupings: [], maxRows: { csv: 50000, xlsx: 50000, pdf: 2000 }, columns: [col("rank", "Rank", true)] },
  ],
  formats: ["csv", "xlsx", "pdf"],
  purpose: { min: 10, max: 200 },
};

const historyPage = (items = []) => ({ data: { items, total: items.length, page: 1, totalPages: 1 } });
const item = (overrides = {}) => ({ reportId: "RPT-20261120-ABCDEFGH", dataset: "jobs", format: "csv", recordCount: 12, createdAt: "2026-11-20T06:05:00.000Z", preparedBy: { name: "Maria Santos", role: "admin" }, regeneratedFrom: null, ...overrides });
const blobResponse = (id = "RPT-20261120-ABCDEFGH") => ({ data: new Blob(["x"]), headers: { "content-disposition": `attachment; filename="${id}.csv"`, "x-report-id": id } });

// The page's filter bar, handed down: the generator has no period or filter controls of its own.
const SCOPE = { period: "30d", from: "", to: "", municipality: "", text: "Last 30 days · All municipalities", ready: true };
const open = async (scope = SCOPE) => {
  render(<ReportGeneratorPanel scope={scope} />);
  await screen.findByLabelText("Report");
};
const choose = async (user, label) => user.selectOptions(screen.getByLabelText("Report"), label);
const lastBody = (fn) => fn.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  adminAPI.getReportCatalog.mockResolvedValue({ data: catalog });
  adminAPI.getAnalyticsFilterOptions.mockResolvedValue({ data: { municipalities: ["Gasan"], industries: ["Retail"], jobTypes: [], workNatures: [], years: [2026, 2025], ageBrackets: [] } });
  adminAPI.listReportExports.mockResolvedValue(historyPage([]));
});

describe("ReportGeneratorPanel", () => {
  test("offers only the datasets the catalog gives this role, and nothing else until one is chosen", async () => {
    await open();
    const options = within(screen.getByLabelText("Report")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a report", "Jobs", "Hires and placements (unnamed)", "Employer performance ranking"]);
    expect(screen.queryByLabelText("Period")).toBeNull();
    expect(screen.getByRole("button", { name: "Generate and download" }).disabled).toBe(true);
  });

  test("only the catalog columns are offered, the defaults ticked; columns can be changed", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    expect(screen.getByLabelText("Title").checked).toBe(true);
    expect(screen.getByLabelText("Hires").checked).toBe(false);
    expect(screen.queryByLabelText("Email")).toBeNull();
    await user.click(screen.getByLabelText("Hires"));
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).columns).toEqual(["title", "employer", "hires"]);
  });

  test("no column chosen blocks Generate and says why", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByLabelText("Title"));
    await user.click(screen.getByLabelText("Employer", { selector: "input" }));
    expect(screen.getByText("Choose at least one column.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate and download" }).disabled).toBe(true);
  });

  test("a dataset that needs a purpose keeps Generate disabled until 10 characters are written", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Hires and placements (unnamed)");
    const generate = screen.getByRole("button", { name: "Generate and download" });
    expect(generate.disabled).toBe(true);
    expect(screen.getByText("State the purpose in 10 to 200 characters.")).toBeTruthy();
    await user.type(screen.getByLabelText("Purpose of this report"), "short");
    expect(generate.disabled).toBe(true);
    await user.type(screen.getByLabelText("Purpose of this report"), " but long enough now");
    expect(generate.disabled).toBe(false);
    await user.click(generate);
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).purpose).toBe("short but long enough now");
  });

  test("a grouped report offers no column list", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    await user.selectOptions(screen.getByLabelText("Group by"), "month");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByText("A grouped report has a group and a count.")).toBeTruthy();
  });

  test("it has no period or filter controls of its own and says which scope it uses", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    expect(screen.queryByLabelText("Period")).toBeNull();
    expect(screen.queryByLabelText("Municipality")).toBeNull();
    expect(screen.getByText("Uses the filter bar above: Last 30 days · All municipalities.")).toBeTruthy();
  });

  test("the request carries the page's period and municipality", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open({ ...SCOPE, period: "90d", municipality: "Gasan" });
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).params).toEqual({ period: "90d", municipality: "Gasan" });
  });

  test("a custom scope is sent as its two days, and an unfinished one blocks the buttons", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open({ ...SCOPE, period: "custom", from: "2026-01-01", to: "2026-02-01" });
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).params).toEqual({ period: "custom", from: "2026-01-01", to: "2026-02-01" });
  });

  test("an unfinished custom range disables Preview and Generate", async () => {
    const user = userEvent.setup();
    await open({ ...SCOPE, period: "custom", from: "2026-01-01", to: "", ready: false });
    await choose(user, "Jobs");
    expect(screen.getByRole("button", { name: "Preview" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Generate and download" }).disabled).toBe(true);
  });

  test("a scope with not enough data: the server's answer becomes a clear message and nothing downloads", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ code: "NOT_ENOUGH_DATA" })]) } });
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("There is not enough data for this period and municipality. At least 1 vacancy and 3 applications are needed."));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test("a preview with not enough data says so", async () => {
    const user = userEvent.setup();
    adminAPI.previewReportExport.mockResolvedValue({ data: { recordCount: null, wouldExceedLimit: false, notEnoughData: true, maxRows: 50000, columns: [], sample: [], preparedBy: { name: "M", role: "admin" } } });
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("There is not enough data for this period and municipality. At least 1 vacancy and 3 applications are needed.")).toBeTruthy();
  });

  test("Preview shows the count, the first rows and the prepared-by block, and does not download", async () => {
    const user = userEvent.setup();
    adminAPI.previewReportExport.mockResolvedValue({
      data: { recordCount: 42, wouldExceedLimit: false, maxRows: 50000, columns: [{ key: "title", label: "Title" }], sample: [{ title: "Cashier" }], preparedBy: { name: "Maria Santos", role: "admin", office: "PESO Manager" } },
    });
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("42 record(s) in this report.")).toBeTruthy();
    expect(within(dialog).getByText("Cashier")).toBeTruthy();
    expect(within(dialog).getByText(/prepared by Maria Santos \(admin\), PESO Manager/)).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
  });

  test("a preview over the limit says to narrow the filters", async () => {
    const user = userEvent.setup();
    adminAPI.previewReportExport.mockResolvedValue({ data: { recordCount: null, wouldExceedLimit: true, maxRows: 50000, columns: [], sample: [], preparedBy: { name: "M", role: "admin" } } });
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("This report is over the 50000 row limit. Narrow the filters.")).toBeTruthy();
  });

  test("Generate downloads the file under the server's name and announces the report ID, then refreshes history", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open();
    await choose(user, "Jobs");
    const before = adminAPI.listReportExports.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith("RPT-20261120-ABCDEFGH.csv", expect.any(Blob)));
    expect(toast.success).toHaveBeenCalledWith("Report ready: RPT-20261120-ABCDEFGH");
    await waitFor(() => expect(adminAPI.listReportExports.mock.calls.length).toBeGreaterThan(before));
  });

  test("the request never carries a preparer, a report ID or a time", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(Object.keys(lastBody(adminAPI.generateReportExport)).sort()).toEqual(["columns", "dataset", "format", "grouping", "params"]);
  });

  test("a server error code becomes a plain message, even when the body is a Blob", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ code: "EXPORT_TOO_LARGE" })]) } });
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByRole("button", { name: "Generate and download" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This report is too large. Narrow the filters and try again."));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test("the PDF row limit is stated when PDF is chosen", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByLabelText("PDF"));
    expect(screen.getByText("PDF reports are limited to 2000 rows.")).toBeTruthy();
  });

  test("a catalog that fails to load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.getReportCatalog.mockRejectedValueOnce(new Error("boom"));
    render(<ReportGeneratorPanel scope={SCOPE} />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Report")).toBeTruthy();
  });
});

describe("report history", () => {
  test("lists reports with their ID, records and preparer; empty state when none", async () => {
    adminAPI.listReportExports.mockResolvedValue(historyPage([item(), item({ reportId: "RPT-20261001-ZZZZZZZZ", regeneratedFrom: "RPT-20261001-AAAAAAAA", dataset: "hires", format: "pdf" })]));
    await open();
    expect(await screen.findByText("RPT-20261120-ABCDEFGH")).toBeTruthy();
    expect(screen.getByText("Regenerated from RPT-20261001-AAAAAAAA")).toBeTruthy();
    expect(screen.getAllByText("Maria Santos").length).toBe(2);
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  test("an empty history says so", async () => {
    await open();
    expect(await screen.findByText("No reports yet.")).toBeTruthy();
  });

  test("Regenerate downloads a new file and reports its ID", async () => {
    const user = userEvent.setup();
    adminAPI.listReportExports.mockResolvedValue(historyPage([item()]));
    adminAPI.regenerateReportExport.mockResolvedValue(blobResponse("RPT-20261123-NEWNEWNE"));
    await open();
    await user.click(await screen.findByRole("button", { name: "Regenerate RPT-20261120-ABCDEFGH" }));
    await waitFor(() => expect(adminAPI.regenerateReportExport).toHaveBeenCalledWith("RPT-20261120-ABCDEFGH"));
    expect(downloadBlob).toHaveBeenCalledWith("RPT-20261123-NEWNEWNE.csv", expect.any(Blob));
    expect(toast.success).toHaveBeenCalledWith("Report ready: RPT-20261123-NEWNEWNE");
  });

  test("a failed history load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.listReportExports.mockRejectedValueOnce(new Error("boom"));
    await open();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No reports yet.")).toBeTruthy();
  });
});
