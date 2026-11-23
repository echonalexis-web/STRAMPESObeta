import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../services/api", () => ({
  adminAPI: { getEmployerPerformance: vi.fn(), getEmployerPerformanceDetail: vi.fn() },
  resolveAssetUrl: (value) => value,
}));
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, BarChart: Box, Bar: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null };
});

const { adminAPI } = await import("../services/api");
const { default: EmployerPerformancePanel } = await import("./EmployerPerformancePanel");
const { default: TopEmployersCard } = await import("./TopEmployersCard");

const ranking = (overrides = {}) => ({
  period: { type: "quarter", label: "2026 Q4 (Oct to Dec)", from: "2026-10-01", to: "2026-12-31", isPartial: true, isFuture: false },
  previous: { label: "2026 Q3 (Jul to Sep)", comparedTo: "same elapsed days" },
  asOf: "2026-11-20T06:00:00.000Z",
  rules: { minPostings: 1, minApplicants: 3 },
  eligibility: { ranked: 2, notEnoughData: 1, excluded: 2 },
  totals: { hires: 20, applicants: 90, postings: 12, formerOrRestricted: { hires: 6, applicants: 20, postings: 3 } },
  responseDataAvailable: false,
  rows: [
    { rank: 1, employerId: "e1", name: "Acme Corp", photo: null, postings: 3, applicants: 20, hires: 8, hireRate: 40, hireRateN: 20, hireRateLower: 21.9, fillRate: 66.7, medianDaysToHire: 9, responseRate: null, previous: { rank: 2, hires: 5 }, hiresChange: 3 },
    { rank: 2, employerId: "e2", name: "Beta Ltd", photo: null, postings: 2, applicants: 8, hires: 3, hireRate: 37.5, hireRateN: 8, hireRateLower: 13.7, fillRate: null, medianDaysToHire: null, responseRate: null, previous: null, hiresChange: null },
  ],
  notEnoughData: [{ employerId: "e3", name: "Tiny Shop", photo: null, postings: 1, applicants: 1, hires: 1 }],
  ...overrides,
});

const detail = () => ({
  period: { label: "2026 Q4 (Oct to Dec)" },
  previous: { label: "2026 Q3 (Jul to Sep)" },
  employer: { id: "e1", name: "Acme Corp", photo: null, eligible: true },
  metrics: { postings: 3, applicants: 20, hires: 8, hireRate: 40, fillRate: 66.7, medianDaysToHire: 9, responseRate: null },
  previousMetrics: { postings: 2, applicants: 10, hires: 5, hireRate: 50, fillRate: null, medianDaysToHire: 12, responseRate: null },
  postings: [{ id: "j1", title: "Cashier", funnel: { applicants: 6, qualified: 4, shortlisted: 2, hired: 1 }, timeToFillDays: 4, closeReason: "filled" }],
});

const lastParams = () => adminAPI.getEmployerPerformance.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  adminAPI.getEmployerPerformance.mockResolvedValue({ data: ranking() });
  adminAPI.getEmployerPerformanceDetail.mockResolvedValue({ data: detail() });
});

describe("EmployerPerformancePanel", () => {
  test("shows the ranking with how it is compared, and the minimum rule", async () => {
    render(<EmployerPerformancePanel />);
    expect((await screen.findAllByText("Acme Corp")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Compared with the same days of 2026 Q3/)).toBeTruthy();
    expect(screen.getByText(/at least 1 posting\(s\) and 3 applicant\(s\)/)).toBeTruthy();
    expect(screen.getByText("40% (of 20)")).toBeTruthy();
    // a missing value is words, not a blank
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(lastParams()).toMatchObject({ period: "quarter", limit: "10" });
  });

  test("the change is written in words", async () => {
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    expect(screen.getByText("up 3")).toBeTruthy();
  });

  test("not-enough-data employers are listed without a rank, and excluded ones are only counted", async () => {
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    expect(screen.getByText(/Not enough data \(1\)/)).toBeTruthy();
    expect(screen.getByText(/2 employer\(s\) not shown/)).toBeTruthy();
    expect(screen.getByText(/still count in the total: 6/)).toBeTruthy();
  });

  test("changing the period asks again; year hides the quarter control", async () => {
    const user = userEvent.setup();
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    await user.selectOptions(screen.getByLabelText("Period"), "year");
    await waitFor(() => expect(lastParams().period).toBe("year"));
    expect(lastParams().quarter).toBeUndefined();
    expect(screen.queryByLabelText("Quarter")).toBeNull();
  });

  test("the chart has a table alternative toggle", async () => {
    const user = userEvent.setup();
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    expect(screen.getByRole("img", { name: /Hires per employer: Acme Corp 8, Beta Ltd 3/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.queryByRole("img", { name: /Hires per employer/ })).toBeNull();
    expect(screen.getByRole("table", { name: "Best and most performative employers" })).toBeTruthy();
  });

  test("empty and error states", async () => {
    const user = userEvent.setup();
    adminAPI.getEmployerPerformance.mockResolvedValueOnce({ data: ranking({ rows: [], notEnoughData: [] }) });
    const { unmount } = render(<EmployerPerformancePanel />);
    expect(await screen.findByText("No ranked employers")).toBeTruthy();
    unmount();
    adminAPI.getEmployerPerformance.mockRejectedValueOnce(new Error("boom"));
    render(<EmployerPerformancePanel />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("Acme Corp")).length).toBeGreaterThan(0);
  });

  test("Details opens the drill-down with counts only", async () => {
    const user = userEvent.setup();
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    await user.click(screen.getAllByRole("button", { name: /Details/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Cashier")).toBeTruthy();
    expect(adminAPI.getEmployerPerformanceDetail).toHaveBeenCalledWith("e1", expect.objectContaining({ period: "quarter" }));
    expect(within(dialog).getByText("Counts only. No applicant is named.")).toBeTruthy();
  });

  test("the response rate column appears only once response data exists", async () => {
    adminAPI.getEmployerPerformance.mockResolvedValue({ data: ranking({ responseDataAvailable: true }) });
    render(<EmployerPerformancePanel />);
    await screen.findAllByText("Acme Corp");
    expect(screen.getByRole("columnheader", { name: "Response rate" })).toBeTruthy();
  });
});

describe("TopEmployersCard", () => {
  const open = () => render(<MemoryRouter><TopEmployersCard /></MemoryRouter>);

  test("lists the top five of the current quarter with a link to the full view", async () => {
    open();
    expect(await screen.findByText("Acme Corp")).toBeTruthy();
    expect(adminAPI.getEmployerPerformance).toHaveBeenCalledWith(expect.objectContaining({ period: "quarter", limit: "5" }));
    expect(screen.getByRole("link", { name: "See full ranking" }).getAttribute("href")).toBe("/admin/reports#employer-performance");
  });

  test("a failed load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.getEmployerPerformance.mockRejectedValueOnce(new Error("boom"));
    open();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme Corp")).toBeTruthy();
  });
});
