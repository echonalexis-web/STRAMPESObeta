import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

let currentUser = { role: "superadmin" };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock("./AdminHeader", () => ({ default: ({ title }) => <h1>{title}</h1> }));
// The generator is mocked; it shows what the page hands it and can pretend a history row's "Set up again" was pressed.
let setUpRow = { dataset: "hires", format: "pdf", municipality: "Gasan", period: { type: "90d", from: "2026-08-23", to: "2026-11-20" } };
vi.mock("../../components/ReportGeneratorPanel", () => ({
  default: ({ scope, prefill, onSetUp }) => (
    <section aria-label="generator">
      <span>{scope.text}</span>
      <span data-testid="scope">{JSON.stringify(scope)}</span>
      <span data-testid="prefill">{JSON.stringify(prefill)}</span>
      <button type="button" onClick={() => onSetUp(setUpRow)}>Pretend set up</button>
    </section>
  ),
}));
vi.mock("../../services/api", () => ({
  adminAPI: { getDashboardOverview: vi.fn(), getAnalyticsOverview: vi.fn() },
  resolveAssetUrl: (value) => value,
}));
vi.mock("recharts", () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, BarChart: Box, Bar: Box, CartesianGrid: () => null, LabelList: () => null, XAxis: () => null, YAxis: () => null };
});

const { adminAPI } = await import("../../services/api");
const { default: AdminDashboard } = await import("./AdminDashboard");
const { default: Reports } = await import("./Reports");

// ---- Dashboard ---------------------------------------------------------------------------

const dashboard = (overrides = {}) => ({
  kpis: {
    activeJobseekers: { value: 120, joinedLast30: 6 },
    verifiedEmployers: { verified: 30, total: 41, pending: 3 },
    openVacancies: { value: 12, closingSoon: 4 },
    applicationsToReview: { value: 8 },
  },
  attention: [
    { key: "employerVerification", count: 3, oldestDays: 10 },
    { key: "moderation", count: 3, reports: 2, appeals: 1 },
    { key: "accountRecovery", count: 0 },
    { key: "closingSoon", count: 4 },
    { key: "hiddenByEmployer", count: 0 },
  ],
  allClear: false,
  jobseekersByMunicipality: [
    { municipality: "Boac (Capital)", value: 80, suppressed: false },
    { municipality: "Gasan", value: 3, suppressed: false },
  ],
  recentActivity: [
    { id: "1", action: "employer.verification.approved", severity: "info", at: "2026-11-19T00:00:00.000Z" },
    { id: "2", action: "report.generated", severity: "warning", at: "2026-11-18T00:00:00.000Z" },
  ],
  ...overrides,
});

const openDashboard = () =>
  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  setUpRow = { dataset: "hires", format: "pdf", municipality: "Gasan", period: { type: "90d", from: "2026-08-23", to: "2026-11-20" } };
  currentUser = { role: "superadmin" };
  adminAPI.getDashboardOverview.mockResolvedValue({ data: dashboard() });
});

describe("Dashboard", () => {
  test("shows the four KPI cards with their notes", async () => {
    openDashboard();
    expect(await screen.findByText("Active jobseekers")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("6 joined in the last 30 days")).toBeTruthy();
    expect(screen.getByText("30 of 41")).toBeTruthy();
    expect(screen.getByText("3 pending verification")).toBeTruthy();
    expect(screen.getByText("4 closing within 7 days")).toBeTruthy();
    expect(screen.getByText("Applications to review")).toBeTruthy();
  });

  test("each attention row has its count, a hint and a link to the page that handles it", async () => {
    openDashboard();
    const row = (await screen.findByText("Employers pending verification")).closest("a");
    expect(row.getAttribute("href")).toBe("/admin/verification");
    expect(within(row).getByText("3")).toBeTruthy();
    expect(within(row).getByText("The oldest has waited 10 day(s)")).toBeTruthy();
    expect(screen.getByText("Open reports and appeals").closest("a").getAttribute("href")).toBe("/admin/users/moderation");
    expect(screen.getByText("2 report(s), 1 appeal(s)")).toBeTruthy();
    expect(screen.getByText("Account recovery requests").closest("a").getAttribute("href")).toBe("/admin/account-recovery");
    expect(screen.getByText("Vacancies closing within 7 days").closest("a").getAttribute("href")).toBe("/admin/job-monitoring");
    expect(screen.getByText("Vacancies hidden from the public").closest("a").getAttribute("href")).toBe("/admin/job-monitoring");
  });

  test("a row with a count of 0 stays visible but muted", async () => {
    openDashboard();
    const row = (await screen.findByText("Account recovery requests")).closest("a");
    expect(row.className).toContain("is-muted");
    expect(within(row).getByText("None waiting")).toBeTruthy();
  });

  test("when everything is at 0 it says all clear, in a status region, and keeps the rows", async () => {
    adminAPI.getDashboardOverview.mockResolvedValue({
      data: dashboard({ allClear: true, attention: ["employerVerification", "moderation", "accountRecovery", "closingSoon", "hiddenByEmployer"].map((key) => ({ key, count: 0 })) }),
    });
    openDashboard();
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("All clear. Nothing is waiting for a person right now.")).toBeTruthy();
    const attention = screen.getByRole("heading", { name: "Needs attention" }).closest("section");
    expect(within(attention).getAllByRole("link")).toHaveLength(5);
  });

  test("jobseekers by municipality as bars with the real numbers (small ones too), and a link to Analytics & Reports", async () => {
    openDashboard();
    const table = await screen.findByRole("table", { name: "Active jobseekers by municipality" });
    expect(within(table).getByText("80")).toBeTruthy();
    expect(within(table).getByText("3")).toBeTruthy();
    expect(within(table).queryByText("under 5")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Analytics & Reports" }).getAttribute("href")).toBe("/admin/reports");
  });

  test("recent activity is plain words and a time, nothing about a person", async () => {
    openDashboard();
    expect(await screen.findByText("Employer verification approved")).toBeTruthy();
  });

  test("recent activity is a list with an icon, the time (exact one in the title) and a text flag only for warnings", async () => {
    openDashboard();
    const approved = (await screen.findByText("Employer verification approved")).closest("li");
    const generated = screen.getByText("Report generated").closest("li");
    expect(approved.querySelector("svg")).toBeTruthy();
    expect(approved.querySelector("[aria-hidden='true'] svg")).toBeTruthy();
    const time = approved.querySelector("time");
    expect(time.getAttribute("datetime")).toBe("2026-11-19T00:00:00.000Z");
    expect(time.getAttribute("title")).toBeTruthy();
    expect(within(approved).queryByText("Warning")).toBeNull();
    expect(within(generated).getByText("Warning")).toBeTruthy();
  });

  test("a superadmin sees the Audit Trail link, User Management and Provision staff", async () => {
    openDashboard();
    expect(await screen.findByRole("link", { name: "View full Audit Trail" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "User Management" }).getAttribute("href")).toBe("/admin/users");
    expect(screen.getByRole("link", { name: "Provision staff account" }).getAttribute("href")).toBe("/superadmin/admin-accounts");
    expect(screen.getByRole("link", { name: "Employer Verification" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Job Monitoring" })).toBeTruthy();
  });

  test("a PESO admin does not see the superadmin-only items, and finds people through Find account", async () => {
    currentUser = { role: "admin" };
    openDashboard();
    await screen.findByText("Active jobseekers");
    expect(screen.queryByRole("link", { name: "View full Audit Trail" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Provision staff account" })).toBeNull();
    expect(screen.queryByRole("link", { name: "User Management" })).toBeNull();
    expect(screen.getByRole("link", { name: "Find account" }).getAttribute("href")).toBe("/admin/find-account");
    expect(screen.getByRole("link", { name: "Employer Verification" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Job Monitoring" })).toBeTruthy();
  });

  test("it has no match-weight settings, no date filter and no list tables", async () => {
    openDashboard();
    await screen.findByText("Active jobseekers");
    expect(screen.queryByText(/matching defaults/i)).toBeNull();
    expect(screen.queryByLabelText("Period")).toBeNull();
    expect(screen.queryByRole("table", { name: /employers|vacancies|registrations/i })).toBeNull();
  });

  test("a failed load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.getDashboardOverview.mockRejectedValueOnce(new Error("boom"));
    openDashboard();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Active jobseekers")).toBeTruthy();
  });
});

// ---- Analytics & Reports ------------------------------------------------------------------------

const statusItems = (counts) => {
  const keys = ["pending", "under_review", "shortlisted", "approved", "rejected", "hired", "withdrawn", "other"];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, items: keys.map((key) => ({ key, count: counts[key] || 0, percent: total ? Math.round(((counts[key] || 0) / total) * 1000) / 10 : 0 })) };
};

const overview = (overrides = {}) => ({
  period: { preset: "30d", label: "Last 30 days", from: "2026-10-22", to: "2026-11-20", granularity: "day" },
  municipality: null,
  enoughData: true,
  cards: { applications: 28, hires: 5, vacancies: { open: 12, closed: 21, archived: 2, total: 35 }, jobseekers: 7 },
  trend: {
    granularity: "day",
    applications: [{ key: "2026-11-15", label: "Nov 15", value: 3 }],
    hires: [{ key: "2026-11-15", label: "Nov 15", value: 1 }],
    vacancies: [{ key: "2026-11-15", label: "Nov 15", value: 2 }],
  },
  applicationsByStatus: statusItems({ pending: 8, under_review: 4, shortlisted: 3, rejected: 6, hired: 5, withdrawn: 2 }),
  vacanciesByStatus: { total: 35, items: [{ key: "open", count: 12, percent: 34.3 }, { key: "closed", count: 21, percent: 60 }, { key: "archived", count: 2, percent: 5.7 }] },
  topEmployers: { rows: [{ rank: 1, employerId: "e1", name: "Acme Corp", photo: null, municipality: "Gasan", applicants: 10, hires: 4 }], minimums: { postings: 1, applicants: 3, hires: 1 } },
  topRoles: [{ title: "Service Crew", count: 7 }],
  municipalities: [
    { municipality: "Boac (Capital)", applications: { value: 20, suppressed: false }, hires: { value: 3, suppressed: false }, vacancies: { value: 9, suppressed: false } },
    { municipality: "Gasan", applications: { value: null, suppressed: true }, hires: { value: 0, suppressed: false }, vacancies: { value: null, suppressed: true } },
  ],
  ...overrides,
});

let location;
const Probe = () => {
  location = useLocation();
  return null;
};
const openAnalytics = (url = "/admin/reports") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Reports />
      <Probe />
    </MemoryRouter>
  );
const lastParams = () => adminAPI.getAnalyticsOverview.mock.calls.at(-1)[0];

describe("Analytics & Reports", () => {
  beforeEach(() => {
    adminAPI.getAnalyticsOverview.mockResolvedValue({ data: overview() });
  });

  test("is named Analytics & Reports and opens on the last 30 days, all municipalities", async () => {
    openAnalytics();
    expect(await screen.findByRole("heading", { level: 1, name: "Analytics & Reports" })).toBeTruthy();
    expect(lastParams()).toEqual({ period: "30d" });
    expect(screen.getAllByText("Last 30 days · All municipalities").length).toBeGreaterThan(0);
  });

  test("has ONE filter bar: a period and a municipality, and nothing else to filter by", async () => {
    openAnalytics();
    await screen.findByText("Applications by status");
    expect(screen.getAllByLabelText("Municipality")).toHaveLength(1);
    expect(screen.getAllByRole("group", { name: "Period" })).toHaveLength(1);
    expect(screen.queryByLabelText("Industry")).toBeNull();
    expect(screen.queryByLabelText("Job type")).toBeNull();
  });

  test("changing the period asks again and writes it to the link", async () => {
    const user = userEvent.setup();
    openAnalytics();
    await screen.findByText("Applications by status");
    await user.click(screen.getByRole("button", { name: "90 days" }));
    await waitFor(() => expect(lastParams()).toEqual({ period: "90d" }));
    expect(location.search).toContain("period=90d");
    expect(screen.getAllByText("Last 90 days · All municipalities").length).toBeGreaterThan(0);
  });

  test("changing the municipality asks again and shows it in the scope text", async () => {
    const user = userEvent.setup();
    openAnalytics();
    await screen.findByText("Applications by status");
    await user.selectOptions(screen.getByLabelText("Municipality"), "Gasan");
    await waitFor(() => expect(lastParams()).toEqual({ period: "30d", municipality: "Gasan" }));
    expect(screen.getAllByText("Last 30 days · Gasan").length).toBeGreaterThan(0);
  });

  test("a link restores the view; an unknown value in it is ignored", async () => {
    openAnalytics("/admin/reports?period=12m&municipality=Atlantis");
    await screen.findByText("Applications by status");
    expect(lastParams()).toEqual({ period: "12m" });
  });

  test("a custom range needs both days, shows why, and sends no request until it has them", async () => {
    openAnalytics("/admin/reports?period=custom&from=2026-01-01");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Pick a start and an end date, start first.")).toBeTruthy();
    expect(adminAPI.getAnalyticsOverview).not.toHaveBeenCalled();
  });

  test("Reset returns to the default scope", async () => {
    const user = userEvent.setup();
    openAnalytics("/admin/reports?period=7d&municipality=Gasan");
    await screen.findByText("Applications by status");
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(lastParams()).toEqual({ period: "30d" }));
    expect(location.search).toBe("");
  });

  test("the four summary cards, with the open, closed and archived note", async () => {
    openAnalytics();
    await screen.findByText("Applications by status");
    const cards = screen.getByRole("region", { name: "Summary" });
    expect(within(cards).getByText("28")).toBeTruthy();
    expect(within(cards).getByText("35")).toBeTruthy();
    expect(within(cards).getByText("12 open · 21 closed · 2 archived")).toBeTruthy();
    expect(within(cards).getByText("Hires")).toBeTruthy();
    expect(within(cards).getByText("Jobseekers")).toBeTruthy();
  });

  test("the status legend adds up to the application total and Hired equals the Hires card", async () => {
    openAnalytics();
    const heading = await screen.findByRole("heading", { name: "Applications by status" });
    const card = heading.closest("section");
    expect(within(card).getByText("One definition everywhere. Total: 28 applications.")).toBeTruthy();
    const numbers = within(card).getAllByRole("listitem").map((item) => Number(item.querySelector(".an__lnum").textContent.split(" · ")[0]));
    expect(numbers.reduce((a, b) => a + b, 0)).toBe(28);
    const hired = within(card).getByText("Hired").closest("li").querySelector(".an__lnum").textContent;
    expect(hired).toBe("5 · 17.9%");
    expect(within(screen.getByRole("region", { name: "Summary" })).getByText("5")).toBeTruthy();
    // an unused "Other" row is not shown
    expect(within(card).queryByText("Other")).toBeNull();
  });

  test("vacancies by status: open, closed and archived as three stat boxes with a total", async () => {
    openAnalytics();
    const card = (await screen.findByRole("heading", { name: "Vacancies by status" })).closest("section");
    expect(within(card).getByText("Closed excludes archived. Total: 35.")).toBeTruthy();
    const box = (label) => within(card).getByText(label).closest(".an__stat");
    expect(box("Open").textContent).toBe("12Open");
    expect(box("Closed").textContent).toBe("21Closed");
    expect(box("Archived").textContent).toBe("2Archived");
  });

  test("the trend metric toggle switches the series, and the table alternative lists the values", async () => {
    const user = userEvent.setup();
    openAnalytics();
    await screen.findByRole("heading", { name: "Trend" });
    expect(screen.getByRole("img", { name: /Applications: Nov 15 3/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hires" }));
    expect(screen.getByRole("img", { name: /Hires: Nov 15 1/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Vacancies" }));
    expect(screen.getByRole("img", { name: /Vacancies: Nov 15 2/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Vacancies" })).toBeTruthy();
  });

  const employerRows = [
    { rank: 1, employerId: "e1", name: "Acme Corp", photo: null, municipality: "Gasan", applicants: 14, hires: 4 },
    { rank: 2, employerId: "e2", name: "Beta Trading with a very long company name that has to wrap on a phone", photo: null, municipality: null, applicants: 9, hires: 2 },
    { rank: 3, employerId: "e3", name: "Cebu Pacific Foods", photo: null, municipality: "Boac (Capital)", applicants: 5, hires: 1 },
  ];
  const withEmployers = (rows) =>
    adminAPI.getAnalyticsOverview.mockResolvedValue({ data: overview({ topEmployers: { rows, minimums: { postings: 1, applicants: 3, hires: 1 } } }) });
  const employersCard = async () => (await screen.findByRole("heading", { name: "Top employers by hires" })).closest("section");

  test("top employers are one ordered list in rank order, with no chart", async () => {
    withEmployers(employerRows);
    openAnalytics();
    const card = await employersCard();
    const list = within(card).getByRole("list", { name: "Top employers by hires" });
    expect(list.tagName).toBe("OL");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".an__rank-name").textContent)).toEqual(["Acme Corp", "Beta Trading with a very long company name that has to wrap on a phone", "Cebu Pacific Foods"]);
    expect(rows.map((row) => row.querySelector(".an__rank-n").textContent)).toEqual(["1", "2", "3"]);
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.querySelector(".recharts-wrapper, svg.recharts-surface")).toBeNull();
    expect(within(card).getByText("Needs 1+ posting, 3+ applicants and 1+ hire in the period.")).toBeTruthy();
  });

  test("each employer row has the municipality as muted text, the applicants line and the hires at the right", async () => {
    withEmployers(employerRows);
    openAnalytics();
    const first = within(await employersCard()).getAllByRole("listitem")[0];
    expect(within(first).getByText("Gasan").className).toContain("an__rank-meta");
    expect(within(first).getByText("14 applicants")).toBeTruthy();
    expect(first.querySelector(".an__rank-value").textContent).toBe("4 hires");
    // a row without a municipality simply has none
    const second = within(await employersCard()).getAllByRole("listitem")[1];
    expect(second.querySelector(".an__rank-meta")).toBeNull();
  });

  test("the bars are proportional to the top employer, and rows are not links or buttons", async () => {
    withEmployers(employerRows);
    openAnalytics();
    const card = await employersCard();
    const widths = within(card).getAllByRole("listitem").map((row) => row.querySelector(".an__rank-fill").style.width);
    expect(widths).toEqual(["100%", "50%", "25%"]);
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  test("a single employer is one row, not a chart plus a repeat", async () => {
    withEmployers(employerRows.slice(0, 1));
    openAnalytics();
    const card = await employersCard();
    expect(within(card).getAllByRole("listitem")).toHaveLength(1);
    expect(within(card).getAllByText("Acme Corp")).toHaveLength(1);
  });

  test("places nobody holds yet are quiet placeholders: not in the ranking a screen reader hears, and none when the list is full", async () => {
    withEmployers(employerRows.slice(0, 1));
    openAnalytics();
    let card = await employersCard();
    expect(card.querySelectorAll(".an__rank-row--open")).toHaveLength(4);
    expect([...card.querySelectorAll(".an__rank-row--open .an__rank-n")].map((n) => n.textContent)).toEqual(["2", "3", "4", "5"]);
    expect(card.querySelector(".an__rank-row--open").getAttribute("aria-hidden")).toBe("true");
    expect(within(card).getAllByRole("listitem")).toHaveLength(1);
    expect(within(card).getAllByText("Open spot")).toHaveLength(4);
  });

  test("a full list of five has no placeholders", async () => {
    withEmployers(Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, employerId: `e${i}`, name: `Employer ${i}`, photo: null, municipality: null, applicants: 9, hires: 5 - i })));
    openAnalytics();
    const card = await employersCard();
    expect(card.querySelectorAll(".an__rank-row--open")).toHaveLength(0);
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
  });

  test("the roles card uses the same ranked rows", async () => {
    withEmployers(employerRows);
    openAnalytics();
    const roles = (await screen.findByRole("heading", { name: "Most applied-to roles" })).closest("section");
    const rows = within(roles).getAllByRole("listitem");
    expect(rows[0].className).toBe((await employersCard()).querySelector("li").className);
  });

  test("when nobody qualifies the chart is hidden and a short message shows instead", async () => {
    adminAPI.getAnalyticsOverview.mockResolvedValue({ data: overview({ topEmployers: { rows: [], minimums: { postings: 1, applicants: 3, hires: 1 } } }) });
    openAnalytics();
    expect(await screen.findByText("Nothing to rank yet.")).toBeTruthy();
    const card = await employersCard();
    expect(within(card).queryByRole("list")).toBeNull();
    expect(within(card).queryByRole("img", { name: /Hires per employer/ })).toBeNull();
    expect(screen.getByText(/No employer meets the minimum for this period and municipality/)).toBeTruthy();
  });

  test("roles: one ranked row per role with the number of applications", async () => {
    openAnalytics();
    const roles = (await screen.findByRole("heading", { name: "Most applied-to roles" })).closest("section");
    const row = within(roles).getByText("Service Crew").closest("li");
    expect(row.querySelector(".an__rank-n").textContent).toBe("1");
    expect(row.querySelector(".an__rank-value").textContent).toBe("7 applications");
  });

  test("municipality table: under 5 for a hidden cell, a real 0 stays 0, and the names are buttons that set and clear the filter", async () => {
    const user = userEvent.setup();
    openAnalytics();
    const table = await screen.findByRole("table", { name: "By municipality" });
    const gasan = within(table).getByRole("button", { name: "Filter by Gasan" }).closest("tr");
    expect(within(gasan).getAllByText("under 5")).toHaveLength(2);
    expect(within(gasan).getByText("0")).toBeTruthy();
    await user.click(within(table).getByRole("button", { name: "Filter by Gasan" }));
    await waitFor(() => expect(lastParams()).toEqual({ period: "30d", municipality: "Gasan" }));
    const pressed = within(await screen.findByRole("table", { name: "By municipality" })).getByRole("button", { name: "Clear the Gasan filter" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    await user.click(pressed);
    await waitFor(() => expect(lastParams()).toEqual({ period: "30d" }));
  });

  test("the generator gets the filter bar's scope", async () => {
    openAnalytics("/admin/reports?period=7d&municipality=Gasan");
    await screen.findByText("Applications by status");
    const scope = JSON.parse(screen.getByTestId("scope").textContent);
    expect(scope).toMatchObject({ period: "7d", municipality: "Gasan", text: "Last 7 days · Gasan", ready: true });
  });

  test("Set up again: the history row's scope becomes the filter bar and its report and file type go to the generator", async () => {
    const user = userEvent.setup();
    openAnalytics();
    await screen.findByText("Applications by status");
    await user.click(screen.getByRole("button", { name: "Pretend set up" }));
    await waitFor(() => expect(lastParams()).toEqual({ period: "90d", municipality: "Gasan" }));
    expect(location.search).toContain("period=90d");
    expect(location.search).not.toContain("report=");
    const prefill = JSON.parse(screen.getByTestId("prefill").textContent);
    expect(prefill).toMatchObject({ dataset: "hires", format: "pdf" });
    expect(typeof prefill.nonce).toBe("number");
  });

  test("Set up again from a year or custom period becomes a custom range in the filter bar", async () => {
    const user = userEvent.setup();
    setUpRow = { dataset: "jobs", format: "csv", municipality: null, period: { type: "quarter", from: "2026-07-01", to: "2026-09-30" } };
    openAnalytics();
    await screen.findByText("Applications by status");
    await user.click(screen.getByRole("button", { name: "Pretend set up" }));
    await waitFor(() => expect(lastParams()).toEqual({ period: "custom", from: "2026-07-01", to: "2026-09-30" }));
    expect(screen.getByRole("button", { name: "Custom range" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("the list tables that duplicate User Management and Job Monitoring are gone", async () => {
    openAnalytics();
    await screen.findByText("Applications by status");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/Export CSV/i)).toBeNull();
  });

  test("a failed load can be retried", async () => {
    const user = userEvent.setup();
    adminAPI.getAnalyticsOverview.mockRejectedValueOnce(new Error("boom"));
    openAnalytics();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Applications by status")).toBeTruthy();
  });
});
