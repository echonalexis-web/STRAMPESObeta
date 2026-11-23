import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
const { default: ReportGeneratorPanel } = await import("./ReportGeneratorPanel");

const maxRows = { csv: 50000, xlsx: 50000, pdf: 2000 };
const catalog = {
  datasets: [
    { id: "jobs", label: "Jobs", section: "jobs", needsPurpose: false, groupings: ["none"], defaultGrouping: "none", maxRows, columns: [{ key: "title", label: "Title", default: true }] },
    { id: "hires", label: "Hires", section: "jobs", needsPurpose: true, groupings: ["none"], defaultGrouping: "none", maxRows, columns: [{ key: "hiredAt", label: "Hire date", default: true }] },
  ],
  formats: ["csv", "xlsx", "pdf"],
  purpose: { min: 10, max: 200 },
};
const SCOPE = { period: "30d", from: "", to: "", municipality: "", text: "Last 30 days · All municipalities", ready: true };

const row = (overrides = {}) => ({
  reportId: "RPT-20261120-ABCDEFGH",
  dataset: "hires",
  format: "pdf",
  recordCount: 12,
  createdAt: "2026-11-20T06:05:00.000Z",
  preparedBy: { name: "Maria Santos", role: "admin" },
  period: { type: "30d", from: "2026-10-22", to: "2026-11-20" },
  municipality: "Gasan",
  result: "made",
  blockedReason: null,
  ...overrides,
});
const page = (items = []) => ({ data: { items, total: items.length, page: 1, totalPages: 1 } });

// Stands in for the page: it keeps what "Set up again" hands back and gives it to the generator.
function Harness({ onSetUp }) {
  const [prefill, setPrefill] = useState(null);
  return (
    <ReportGeneratorPanel
      scope={SCOPE}
      prefill={prefill}
      onSetUp={(item) => {
        onSetUp(item);
        setPrefill({ dataset: item.dataset, format: item.format, nonce: 1 });
      }}
    />
  );
}

const openHistory = async (user) => {
  render(<Harness onSetUp={onSetUp} />);
  await screen.findByLabelText("Report");
  const button = screen.getByRole("button", { name: "Report history" });
  await user.click(button);
  return { button, dialog: await screen.findByRole("dialog") };
};
let onSetUp;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout, so every element reports no boxes and the shared modal hook finds nothing to
  // focus. Pretend every element is rendered so focus moves in and the Tab trap has something to cycle.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  onSetUp = vi.fn();
  adminAPI.getReportCatalog.mockResolvedValue({ data: catalog });
  adminAPI.listReportExports.mockResolvedValue(page([]));
});

describe("Report history dialog", () => {
  test("the button opens a labelled dialog and only then fetches the history; nothing is exported", async () => {
    const user = userEvent.setup();
    render(<Harness onSetUp={onSetUp} />);
    await screen.findByLabelText("Report");
    expect(adminAPI.listReportExports).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Report history" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("rhm-title");
    expect(within(dialog).getByRole("heading", { name: "Report history" })).toBeTruthy();
    expect(within(dialog).getByText("Records of reports made. Files are not stored; running one again reads today's data. Kept for 24 months.")).toBeTruthy();
    await waitFor(() => expect(adminAPI.listReportExports).toHaveBeenCalledTimes(1));
    expect(adminAPI.listReportExports.mock.calls[0][0]).toMatchObject({ page: 1, limit: 10, sort: "newest" });
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
    expect(adminAPI.previewReportExport).not.toHaveBeenCalled();
  });

  test("focus moves into the dialog; Esc closes it and focus returns to the button", async () => {
    const user = userEvent.setup();
    const { button, dialog } = await openHistory(user);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  test("the Close button closes it and focus returns to the button", async () => {
    const user = userEvent.setup();
    const { button, dialog } = await openHistory(user);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  test("Tab stays inside the dialog", async () => {
    const user = userEvent.setup();
    const { dialog } = await openHistory(user);
    await screen.findByText("No reports yet.");
    for (let i = 0; i < 25; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  test("empty state, with the pagination still shown", async () => {
    const user = userEvent.setup();
    const { dialog } = await openHistory(user);
    expect(await within(dialog).findByText("No reports yet.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /next/i })).toBeTruthy();
  });

  test("a filter that matches nothing says so and Reset brings the list back", async () => {
    const user = userEvent.setup();
    const { dialog } = await openHistory(user);
    await within(dialog).findByText("No reports yet.");
    adminAPI.listReportExports.mockResolvedValue(page([]));
    await user.selectOptions(within(dialog).getByLabelText("File type"), "pdf");
    expect(await within(dialog).findByText("No reports match these filters.")).toBeTruthy();
    expect(adminAPI.listReportExports.mock.calls.at(-1)[0]).toMatchObject({ format: "pdf", page: 1 });
    adminAPI.listReportExports.mockResolvedValue(page([row()]));
    await user.click(within(dialog).getAllByRole("button", { name: "Reset" })[0]);
    expect(await within(dialog).findByRole("table")).toBeTruthy();
    expect(adminAPI.listReportExports.mock.calls.at(-1)[0].format).toBeUndefined();
  });

  test("a row shows the date, report, file type, period, municipality, preparer and result; a blocked one says why", async () => {
    const user = userEvent.setup();
    adminAPI.listReportExports.mockResolvedValue(page([row(), row({ reportId: "RPT-2", dataset: "jobs", format: "csv", municipality: null, result: "blocked", blockedReason: "NOT_ENOUGH_DATA" })]));
    const { dialog } = await openHistory(user);
    const table = await within(dialog).findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Hires and placements (unnamed)")).toBeTruthy();
    expect(within(rows[0]).getByText("PDF")).toBeTruthy();
    expect(within(rows[0]).getByText("Last 30 days (2026-10-22 – 2026-11-20)")).toBeTruthy();
    expect(within(rows[0]).getByText("Gasan")).toBeTruthy();
    expect(within(rows[0]).getByText("Maria Santos")).toBeTruthy();
    expect(within(rows[0]).getByText("Made")).toBeTruthy();
    expect(within(rows[1]).getByText("All municipalities")).toBeTruthy();
    expect(within(rows[1]).getByText("Blocked · Not enough data")).toBeTruthy();
  });

  test("Set up again prefills the generator with the report and file type, closes the dialog and exports nothing", async () => {
    const user = userEvent.setup();
    adminAPI.listReportExports.mockResolvedValue(page([row()]));
    const { button, dialog } = await openHistory(user);
    await user.click(await within(dialog).findByRole("button", { name: "Set up RPT-20261120-ABCDEFGH again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSetUp).toHaveBeenCalledWith(expect.objectContaining({ reportId: "RPT-20261120-ABCDEFGH", dataset: "hires", format: "pdf" }));
    await waitFor(() => expect(screen.getByLabelText("Report").value).toBe("hires"));
    expect(within(screen.getByRole("group", { name: "File type" })).getByRole("button", { name: "PDF" }).getAttribute("aria-pressed")).toBe("true");
    expect(adminAPI.generateReportExport).not.toHaveBeenCalled();
    expect(adminAPI.previewReportExport).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  test("a failed load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.listReportExports.mockRejectedValueOnce(new Error("boom"));
    const { dialog } = await openHistory(user);
    await user.click(await within(dialog).findByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText("No reports yet.")).toBeTruthy();
  });
});
