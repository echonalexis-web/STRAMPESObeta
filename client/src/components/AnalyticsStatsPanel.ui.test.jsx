import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../services/api", () => ({
  adminAPI: { getAnalyticsSummary: vi.fn(), getAnalyticsFilterOptions: vi.fn() },
}));
// Recharts needs real layout; the chart is not what these tests are about.
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, BarChart: Box, Bar: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null };
});

const { adminAPI } = await import("../services/api");
const { default: AnalyticsStatsPanel } = await import("./AnalyticsStatsPanel");

const summary = (overrides = {}) => ({
  filters: {},
  period: { type: "year", label: "2026", from: "2026-01-01", to: "2026-12-31", isPartial: false, asOf: "2026-11-20T00:00:00.000Z" },
  cards: [{ key: "postings", value: 12 }, { key: "slots", value: 20 }, { key: "applications", value: 40 }, { key: "hires", value: 5 }],
  series: [{ key: "postingsByMonth", points: [{ key: "2026-01", label: "Jan 2026", value: 12 }] }],
  breakdowns: [{ key: "status", total: 12, items: [{ key: "active", label: "active", value: 9 }, { key: "closed", label: "closed", value: 3 }] }],
  ...overrides,
});

let location;
const Probe = () => {
  location = useLocation();
  return null;
};
const open = (url = "/admin") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AnalyticsStatsPanel />
      <Probe />
    </MemoryRouter>
  );
const lastParams = () => adminAPI.getAnalyticsSummary.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  adminAPI.getAnalyticsFilterOptions.mockResolvedValue({
    data: { municipalities: ["Gasan", "Boac (Capital)"], industries: ["Retail"], jobTypes: ["Part-time"], workNatures: ["remote"], years: [2026, 2025], ageBrackets: ["15-17"] },
  });
  adminAPI.getAnalyticsSummary.mockResolvedValue({ data: summary() });
});

describe("AnalyticsStatsPanel", () => {
  test("loads the jobs section with the default year and shows cards and a breakdown", async () => {
    open();
    expect(await screen.findByText("Open slots")).toBeTruthy();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(lastParams()).toMatchObject({ section: "jobs", period: "year", scope: "all" });
    expect(screen.getByRole("table", { name: "By status" })).toBeTruthy();
  });

  test("a filter change is applied immediately and written to the URL", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Open slots");
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await waitFor(() => expect(screen.getByLabelText("Municipality").querySelectorAll("option").length).toBeGreaterThan(1));
    await user.selectOptions(screen.getByLabelText("Municipality"), "Gasan");
    await waitFor(() => expect(lastParams().municipality).toBe("Gasan"));
    expect(location.search).toContain("municipality=Gasan");
  });

  test("a link restores the same view, and a filter hidden for the section is stripped", async () => {
    open("/admin?section=employers&verification=pending,under_review&ageBracket=15-17");
    await screen.findByText("Open slots");
    await waitFor(() => expect(lastParams()).toMatchObject({ section: "employers", verification: "pending,under_review" }));
    expect(lastParams().ageBracket).toBeUndefined();
    await waitFor(() => expect(location.search).not.toContain("ageBracket"));
  });

  test("switching section keeps the municipality and drops the job-only filters", async () => {
    const user = userEvent.setup();
    open("/admin?municipality=Gasan&industry=Retail");
    await screen.findByText("Open slots");
    await user.click(screen.getByRole("button", { name: "Applicants" }));
    await waitFor(() => expect(lastParams().section).toBe("applicants"));
    expect(lastParams().municipality).toBe("Gasan");
    expect(lastParams().industry).toBeUndefined();
  });

  test("a suppressed count is shown as under 5, never a number", async () => {
    adminAPI.getAnalyticsSummary.mockResolvedValue({
      data: summary({ cards: [{ key: "applicants", value: null, suppressed: true }], breakdowns: [{ key: "ageBracket", total: null, items: [{ key: "15-17", label: "15-17", value: null, suppressed: true }] }] }),
    });
    open("/admin?section=applicants");
    expect((await screen.findAllByText("under 5")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Counts under 5 are hidden to protect privacy.")).toBeTruthy();
  });

  test("an error shows a retry that loads again", async () => {
    const user = userEvent.setup();
    adminAPI.getAnalyticsSummary.mockRejectedValueOnce(new Error("boom"));
    open();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Open slots")).toBeTruthy();
    expect(adminAPI.getAnalyticsSummary).toHaveBeenCalledTimes(2);
  });

  test("an empty result shows the empty state with Clear filters when filters are active", async () => {
    adminAPI.getAnalyticsSummary.mockResolvedValue({ data: summary({ cards: [{ key: "postings", value: 0 }], series: [], breakdowns: [] }) });
    open("/admin?municipality=Gasan");
    expect(await screen.findByText("No data for these filters")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  test("Clear filters is hidden when no filter is active", async () => {
    open();
    await screen.findByText("Open slots");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  test("a custom period without both dates sends no request and shows a hint", async () => {
    open("/admin?period=custom&from=2026-01-01");
    expect(await screen.findByText("Pick both a start and an end date.")).toBeTruthy();
    expect(adminAPI.getAnalyticsSummary).not.toHaveBeenCalled();
  });

  test("a slow older answer never replaces a newer one", async () => {
    const user = userEvent.setup();
    let resolveSlow;
    adminAPI.getAnalyticsSummary
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockResolvedValue({ data: summary({ cards: [{ key: "postings", value: 77 }] }) });
    open();
    await user.click(screen.getByRole("button", { name: "Employers" }));
    expect(await screen.findByText("77")).toBeTruthy();
    resolveSlow({ data: summary({ cards: [{ key: "postings", value: 11 }] }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("77")).toBeTruthy();
    expect(screen.queryByText("11")).toBeNull();
  });

  test("the chart has a table alternative", async () => {
    open();
    await screen.findByText("Open slots");
    const details = screen.getByText("Show as table").closest("details");
    expect(within(details).getByText("Jan 2026")).toBeTruthy();
  });
});
