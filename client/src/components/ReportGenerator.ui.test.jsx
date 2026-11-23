import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("./feedback/context", () => ({ useToast: () => toast }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { name: "Maria Santos", role: "admin" } }) }));
vi.mock("../utils/exportUtils", () => ({ downloadBlob: vi.fn() }));
vi.mock("../services/api", () => ({
  adminAPI: {
    getReportCatalog: vi.fn(),
    previewReportExport: vi.fn(),
    generateReportExport: vi.fn(),
    listReportExports: vi.fn(),
  },
}));

const { adminAPI } = await import("../services/api");
const { downloadBlob } = await import("../utils/exportUtils");
const { default: ReportGeneratorPanel } = await import("./ReportGeneratorPanel");

const col = (key, label, def = false) => ({ key, label, default: def });
const maxRows = { csv: 50000, xlsx: 50000, pdf: 2000 };
const catalog = {
  datasets: [
    { id: "jobs", label: "Jobs", section: "jobs", needsPurpose: false, groupings: ["none", "month"], defaultGrouping: "none", maxRows, columns: [col("title", "Title", true), col("employer", "Employer", true), col("hires", "Hires")] },
    { id: "hires", label: "Hires", section: "jobs", needsPurpose: true, groupings: ["none", "month", "ageBracket"], defaultGrouping: "none", maxRows, columns: [col("hiredAt", "Hire date", true), col("ageBracket", "Applicant age bracket", true)] },
    { id: "employer_ranking", label: "Ranking", section: "jobs", needsPurpose: false, groupings: [], maxRows, columns: [col("rank", "Rank", true)] },
  ],
  formats: ["csv", "xlsx", "pdf"],
  purpose: { min: 10, max: 200 },
};

const blobResponse = (id = "RPT-20261120-ABCDEFGH") => ({ data: new Blob(["x"]), headers: { "content-disposition": `attachment; filename="${id}.csv"`, "x-report-id": id } });
// The page's filter bar, handed down: the generator has no period or filter controls of its own.
const SCOPE = { period: "30d", from: "", to: "", municipality: "", text: "Last 30 days · All municipalities", ready: true };

const open = async (scope = SCOPE, prefill = null) => {
  render(
    <MemoryRouter>
      <ReportGeneratorPanel scope={scope} prefill={prefill} />
    </MemoryRouter>
  );
  await screen.findByLabelText("Report");
};
const choose = (user, label) => user.selectOptions(screen.getByLabelText("Report"), label);
const lastBody = (fn) => fn.mock.calls.at(-1)[0];
const generateButton = () => screen.getByRole("button", { name: "Generate and download" });
const previewButton = () => screen.getByRole("button", { name: "Preview" });
const disabled = (button) => button.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  vi.clearAllMocks();
  adminAPI.getReportCatalog.mockResolvedValue({ data: catalog });
});

describe("the Generate a report card layout", () => {
  test("one flat card: a single Report label, a File type group, and no numbered legend", async () => {
    await open();
    expect(screen.getAllByText("Report", { selector: "label" })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "File type" })).toBeTruthy();
    expect(screen.queryByText(/^1\. /)).toBeNull();
    expect(document.querySelector("fieldset")).toBeNull();
    expect(screen.getByRole("heading", { name: "Generate a report" })).toBeTruthy();
    expect(screen.getByText("Uses the filter bar above: Last 30 days · All municipalities.")).toBeTruthy();
  });

  test("the Report history button sits in the card header and opens a dialog, not a page", async () => {
    await open();
    const button = screen.getByRole("button", { name: "Report history" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    const heading = screen.getByRole("heading", { name: "Generate a report" });
    expect(button.closest(".rg__head")).toBe(heading.closest(".rg__head"));
    expect(screen.queryByRole("link", { name: "Report history" })).toBeNull();
  });

  test("the history list is not on the page itself, and nothing is fetched until the dialog is opened", async () => {
    await open();
    expect(screen.queryByText("No reports yet.")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(adminAPI.listReportExports).not.toHaveBeenCalled();
  });

  test("it names who prepares the report, from the signed-in user, and says every export is logged", async () => {
    await open();
    expect(screen.getByText("Prepared by Maria Santos, taken from your sign-in. Every export is logged before the file is made.")).toBeTruthy();
  });

  test("file type chips: CSV, XLSX and PDF, CSV chosen first", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    const group = screen.getByRole("group", { name: "File type" });
    expect(within(group).getByRole("button", { name: "CSV" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(group).getByRole("button", { name: "PDF" }));
    expect(within(group).getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("PDF reports are limited to 2000 rows.")).toBeTruthy();
  });
});

describe("what is missing is only said after a press", () => {
  test("nothing is reported as missing on arrival; the buttons are aria-disabled but still focusable", async () => {
    await open();
    expect(screen.queryByText("Choose a report first.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(disabled(generateButton())).toBe(true);
    expect(disabled(previewButton())).toBe(true);
    expect(generateButton().hasAttribute("disabled")).toBe(false);
  });

  test("pressing Generate without a report shows the message as an alert tied to the select, and calls nothing", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(generateButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Choose a report first.");
    const select = screen.getByLabelText("Report");
    expect(select.getAttribute("aria-describedby")).toBe(alert.id);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(select);
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
  });

  test("pressing Preview without a report does the same", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(previewButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a report first.");
    expect(adminAPI.previewReportExport).not.toHaveBeenCalled();
  });

  test("choosing a report clears the message and turns the buttons on", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(generateButton());
    await screen.findByRole("alert");
    await choose(user, "Jobs");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(disabled(generateButton())).toBe(false);
  });

  test("no column chosen: aria-disabled, and pressing says why", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    await user.click(screen.getByLabelText("Title"));
    await user.click(screen.getByLabelText("Employer", { selector: "input" }));
    expect(screen.queryByText("Choose at least one column.")).toBeNull();
    expect(disabled(generateButton())).toBe(true);
    await user.click(generateButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Choose at least one column.");
  });

  test("a dataset that needs a purpose is aria-disabled until 10 characters are written", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Hires and placements (unnamed)");
    expect(disabled(generateButton())).toBe(true);
    expect(screen.queryByText("State the purpose in 10 to 200 characters.")).toBeNull();
    await user.click(generateButton());
    expect((await screen.findByRole("alert")).textContent).toBe("State the purpose in 10 to 200 characters.");
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await user.type(screen.getByLabelText("Purpose of this report"), "Quarterly placement report");
    expect(disabled(generateButton())).toBe(false);
    await user.click(generateButton());
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).purpose).toBe("Quarterly placement report");
  });

  test("an unfinished custom range keeps the buttons off and says so after a press", async () => {
    const user = userEvent.setup();
    await open({ ...SCOPE, period: "custom", from: "2026-01-01", to: "", ready: false });
    await choose(user, "Jobs");
    expect(disabled(generateButton())).toBe(true);
    await user.click(generateButton());
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
  });
});

describe("what it asks for", () => {
  test("only the catalog columns, defaults ticked; a changed choice is sent", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open();
    await choose(user, "Jobs");
    expect(screen.getByLabelText("Title").checked).toBe(true);
    expect(screen.getByLabelText("Hires").checked).toBe(false);
    expect(screen.queryByLabelText("Email")).toBeNull();
    await user.click(screen.getByLabelText("Hires"));
    await user.click(generateButton());
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).columns).toEqual(["title", "employer", "hires"]);
  });

  test("a grouped report offers no column list", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    await user.selectOptions(screen.getByLabelText("Group by"), "month");
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  test("it has no period or filter controls of its own", async () => {
    const user = userEvent.setup();
    await open();
    await choose(user, "Jobs");
    expect(screen.queryByLabelText("Period")).toBeNull();
    expect(screen.queryByLabelText("Municipality")).toBeNull();
  });

  test("the request carries the page's period and municipality, and never a preparer, ID or time", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open({ ...SCOPE, period: "90d", municipality: "Gasan" });
    await choose(user, "Jobs");
    await user.click(generateButton());
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    const body = lastBody(adminAPI.generateReportExport);
    expect(body.params).toEqual({ period: "90d", municipality: "Gasan" });
    expect(Object.keys(body).sort()).toEqual(["columns", "dataset", "format", "grouping", "params"]);
  });

  test("a custom scope is sent as its two days", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open({ ...SCOPE, period: "custom", from: "2026-01-01", to: "2026-02-01" });
    await choose(user, "Jobs");
    await user.click(generateButton());
    await waitFor(() => expect(adminAPI.generateReportExport).toHaveBeenCalled());
    expect(lastBody(adminAPI.generateReportExport).params).toEqual({ period: "custom", from: "2026-01-01", to: "2026-02-01" });
  });

  test("a prefilled report and file type (from Set up again) are already chosen", async () => {
    await open(SCOPE, { dataset: "hires", format: "pdf" });
    await waitFor(() => expect(screen.getByLabelText("Report").value).toBe("hires"));
    expect(within(screen.getByRole("group", { name: "File type" })).getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    // nothing was exported by that
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
    expect(adminAPI.previewReportExport).not.toHaveBeenCalled();
  });

  test("an unknown prefilled report is ignored", async () => {
    await open(SCOPE, { dataset: "nope", format: "csv" });
    expect(screen.getByLabelText("Report").value).toBe("");
  });
});

describe("preview and download", () => {
  test("Preview shows the count, the first rows and the prepared-by block, and does not download", async () => {
    const user = userEvent.setup();
    adminAPI.previewReportExport.mockResolvedValue({
      data: { recordCount: 42, wouldExceedLimit: false, maxRows: 50000, columns: [{ key: "title", label: "Title" }], sample: [{ title: "Cashier" }], preparedBy: { name: "Maria Santos", role: "admin", office: "PESO Manager" } },
    });
    await open();
    await choose(user, "Jobs");
    await user.click(previewButton());
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
    await user.click(previewButton());
    expect(await screen.findByText("This report is over the 50000 row limit. Narrow the filters.")).toBeTruthy();
  });

  test("a preview with not enough data says so", async () => {
    const user = userEvent.setup();
    adminAPI.previewReportExport.mockResolvedValue({ data: { recordCount: null, wouldExceedLimit: false, notEnoughData: true, maxRows: 50000, columns: [], sample: [], preparedBy: { name: "M", role: "admin" } } });
    await open();
    await choose(user, "Jobs");
    await user.click(previewButton());
    expect(await screen.findByText("There is not enough data for this period and municipality. At least 1 vacancy and 3 applications are needed.")).toBeTruthy();
  });

  test("Generate downloads the file under the server's name and announces the report ID", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockResolvedValue(blobResponse());
    await open();
    await choose(user, "Jobs");
    await user.click(generateButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith("RPT-20261120-ABCDEFGH.csv", expect.any(Blob)));
    expect(toast.success).toHaveBeenCalledWith("Report ready: RPT-20261120-ABCDEFGH");
  });

  test("a server error code becomes a plain message, even when the body is a Blob, and nothing downloads", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ code: "EXPORT_TOO_LARGE" })]) } });
    await open();
    await choose(user, "Jobs");
    await user.click(generateButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This report is too large. Narrow the filters and try again."));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test("not enough data: a clear message and nothing downloads", async () => {
    const user = userEvent.setup();
    adminAPI.generateReportExport.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ code: "NOT_ENOUGH_DATA" })]) } });
    await open();
    await choose(user, "Jobs");
    await user.click(generateButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("There is not enough data for this period and municipality. At least 1 vacancy and 3 applications are needed."));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  test("a catalog that fails to load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.getReportCatalog.mockRejectedValueOnce(new Error("boom"));
    render(
      <MemoryRouter>
        <ReportGeneratorPanel scope={SCOPE} />
      </MemoryRouter>
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Report")).toBeTruthy();
  });
});
