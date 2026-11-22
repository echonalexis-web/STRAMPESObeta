import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { setViewport } from "../../test/viewport";

vi.mock("../../services/api", () => ({
  adminAPI: {
    getUsers: vi.fn(),
    getUserDirectoryCounts: vi.fn(),
    getAccountSecuritySummary: vi.fn(),
    exportUsersCsv: vi.fn(),
    restoreUser: vi.fn(),
    reactivateUser: vi.fn(),
    deactivateUser: vi.fn(),
  },
  resolveAssetUrl: (value) => value,
}));
vi.mock("../../components/DeleteUserModal", () => ({
  default: ({ user }) => <div role="dialog">Delete dialog for {user.name}</div>,
}));

const { adminAPI } = await import("../../services/api");
const { default: UserManagement } = await import("./UserManagement");

const DAY = 24 * 60 * 60 * 1000;
const jobseeker = (extra = {}) => ({
  _id: "j1",
  name: "Ana Cruz",
  role: "jobseeker",
  email: "ana@example.com",
  isActive: true,
  createdAt: "2026-01-05T00:00:00Z",
  lastActiveAt: "2026-05-01T00:00:00Z",
  details: { applications: 4, profilePercent: 80 },
  ...extra,
});
const employer = (extra = {}) => ({
  _id: "e1",
  name: "Acme Corp",
  role: "employer",
  email: "hr@acme.test",
  isActive: true,
  verificationStatus: "verified",
  createdAt: "2025-11-20T00:00:00Z",
  lastActiveAt: null,
  details: { postings: 3, hires: 1 },
  ...extra,
});

const COUNTS = {
  employers: { total: 12, pendingReview: 4, idle90: 2 },
  jobseekers: { total: 30, noEmail: 7, idle90: 11, lockedNow: 1 },
};

let rows;
let total;

const renderPage = (url = "/admin/users?tab=jobseekers") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <UserManagement />
    </MemoryRouter>
  );
const lastParams = () => adminAPI.getUsers.mock.calls.at(-1)[0];

beforeEach(() => {
  rows = [jobseeker()];
  total = 1;
  adminAPI.getUsers.mockImplementation(async () => ({ data: { users: rows, total, totalPages: 1 } }));
  adminAPI.getUserDirectoryCounts.mockResolvedValue({ data: COUNTS });
  adminAPI.getAccountSecuritySummary.mockResolvedValue({ data: { locksLast24h: 2, locksLast7d: 5 } });
});

describe("tabs and chips", () => {
  test("the tabs show the server counts and the page keeps one visually hidden heading", async () => {
    renderPage();
    const jobseekers = await screen.findByRole("tab", { name: /Jobseekers/ });
    await waitFor(() => expect(jobseekers.textContent).toContain("30"));
    expect(screen.getByRole("tab", { name: /Employers/ }).textContent).toContain("12");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.queryByText("Accounts without an email")).toBeNull();
  });

  test("jobseekers get No email, Idle 90+ and Locked now with live counts, and the lockout line", async () => {
    renderPage();
    const noEmail = await screen.findByRole("button", { name: /No email/ });
    await waitFor(() => expect(noEmail.textContent).toContain("(7)"));
    expect(screen.getByRole("button", { name: /Idle 90\+ days/ }).textContent).toContain("(11)");
    expect(screen.getByRole("button", { name: /Locked now/ }).textContent).toContain("(1)");
    expect(screen.queryByRole("button", { name: /Pending review/ })).toBeNull();
    expect(await screen.findByText(/2 in the last 24 hours, 5 in the last 7 days/)).toBeTruthy();
  });

  test("employers get Pending review and Idle only; No email and Locked now do not exist there", async () => {
    renderPage("/admin/users");
    const pending = await screen.findByRole("button", { name: /Pending review/ });
    await waitFor(() => expect(pending.textContent).toContain("(4)"));
    expect(screen.getByRole("button", { name: /Idle 90\+ days/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /No email/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Locked now/ })).toBeNull();
    expect(screen.queryByText(/last 24 hours/)).toBeNull();
  });

  test("a chip is a toggle button that sets the same filter the old checkbox did", async () => {
    renderPage();
    const chip = await screen.findByRole("button", { name: /No email/ });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    await waitFor(() => expect(lastParams().noEmail).toBe("true"));
    expect(screen.getByRole("button", { name: /No email/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /No email/ }));
    await waitFor(() => expect(lastParams().noEmail).toBeUndefined());
  });

  test("Pending review filters by pending plus under review", async () => {
    renderPage("/admin/users");
    fireEvent.click(await screen.findByRole("button", { name: /Pending review/ }));
    await waitFor(() => expect(lastParams().verificationStatus).toBe("pending,under_review"));
  });

  test("a stale link carrying a hidden filter is cleaned and never sent to the API", async () => {
    renderPage("/admin/users?tab=employers&noEmail=1&lockedNow=1&idle90=1");
    await screen.findByText("Ana Cruz");
    await waitFor(() => expect(adminAPI.getUsers).toHaveBeenCalled());
    for (const [params] of adminAPI.getUsers.mock.calls) {
      expect(params.noEmail).toBeUndefined();
      expect(params.lockedNow).toBeUndefined();
    }
    expect(lastParams().idle90).toBe("true");
  });
});

describe("review follow-ups", () => {
  test("switching tab while a search is still pending keeps the box and the list in step", async () => {
    renderPage("/admin/users?tab=jobseekers");
    const box = await screen.findByLabelText("Search");
    fireEvent.change(box, { target: { value: "maria" } });
    fireEvent.click(screen.getByRole("tab", { name: /Employers/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ role: "employer", search: "maria" }));
    expect(screen.getByLabelText("Search").value).toBe("maria");
  });

  test("the tab counts are left out, not shown as 0, when the counts request fails", async () => {
    adminAPI.getUserDirectoryCounts.mockRejectedValue(new Error("down"));
    renderPage();
    await screen.findByText("Ana Cruz");
    const tab = screen.getByRole("tab", { name: /Jobseekers/ });
    expect(tab.textContent).not.toMatch(/d/);
    expect(screen.getByRole("button", { name: "No email" })).toBeTruthy();
  });
});

describe("toolbar", () => {
  test("the merged sort select maps to the existing sort and order params", async () => {
    renderPage();
    const select = await screen.findByLabelText("Sort by");
    fireEvent.change(select, { target: { value: "nameDesc" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "name", order: "desc" }));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "leastRecent" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "lastActive", order: "asc" }));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "newest" } });
    await waitFor(() => expect(lastParams().sort).toBeUndefined());
    expect(screen.queryByLabelText("Order")).toBeNull();
  });

  test("typing in Search filters after a short pause", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText("Search"), { target: { value: "ana" } });
    await waitFor(() => expect(lastParams().search).toBe("ana"), { timeout: 2000 });
  });

  test("Verification is on the Employers tab only; Export sits in the chip row", async () => {
    renderPage("/admin/users");
    expect(await screen.findByLabelText("Verification")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Jobseekers/ }));
    await waitFor(() => expect(screen.queryByLabelText("Verification")).toBeNull());
  });
});

describe("footer, clear filters and empty state", () => {
  test("pagination is always there, even with one page, with the summary and the export hint", async () => {
    renderPage();
    await screen.findByText("Ana Cruz");
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByRole("button", { name: "Next" }).disabled).toBe(true);
    expect(within(nav).getByRole("button", { name: "Previous" }).disabled).toBe(true);
    expect(screen.getByText("Showing 1 to 1 of 1 accounts")).toBeTruthy();
    expect(screen.getByText(/without contact details/)).toBeTruthy();
  });

  test("Clear filters shows only while a filter is active", async () => {
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /No email/ }));
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    fireEvent.click(clear);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull());
    expect(screen.getByRole("button", { name: /No email/ }).getAttribute("aria-pressed")).toBe("false");
  });

  test("no match: the card says so and offers Clear filters", async () => {
    rows = [];
    total = 0;
    renderPage("/admin/users?tab=jobseekers&noEmail=1");
    expect(await screen.findByText("No accounts match these filters")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
  });
});

describe("rows", () => {
  test("a jobseeker row: name, handle, No email note, status, profile percent, applications, dates", async () => {
    rows = [jobseeker({ _id: "j2", email: "", username: "ana_c" })];
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.getByText(/@ana_c/)).toBeTruthy();
    expect(screen.getAllByText(/No email/).length).toBeGreaterThan(0);
    // the key info is in the Key info column and again under the name (the tablet layout shows that copy)
    expect(screen.getAllByText("Profile 80%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 applications").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  test("an employer row shows postings, hires and the verification status", async () => {
    rows = [employer()];
    renderPage("/admin/users");
    await screen.findByText("Acme Corp");
    expect(screen.getAllByText("3 postings, 1 hire").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);
    expect(screen.getByText("Never")).toBeTruthy();
  });

  test("a deleted row says how many days are left", async () => {
    rows = [jobseeker({ isActive: false, deletedAt: "2026-05-01T00:00:00Z", purgeAfter: new Date(Date.now() + 11.5 * DAY).toISOString() })];
    renderPage();
    expect(await screen.findByText("Scheduled for removal in 12 days")).toBeTruthy();
  });

  test("the status badges have text and a shape class per state", async () => {
    rows = [
      jobseeker({ _id: "a" }),
      jobseeker({ _id: "b", name: "B", isActive: false, accountStatus: "suspended" }),
      jobseeker({ _id: "c", name: "C", isActive: false, accountStatus: "deactivated" }),
      jobseeker({ _id: "d", name: "D", isActive: false, deletedAt: "2026-05-01T00:00:00Z" }),
      jobseeker({ _id: "e", name: "E", isActive: false, accountStatus: "banned" }),
    ];
    renderPage();
    await screen.findByText("Ana Cruz");
    const shape = (label) => screen.getAllByText(label, { selector: ".sb" })[0].className;
    expect(shape("Active")).toContain("sb--dot");
    expect(shape("Suspended")).toContain("sb--diamond");
    expect(shape("Deactivated")).toContain("sb--square");
    expect(shape("Deleted")).toContain("sb--ring");
    expect(shape("Banned")).toContain("sb--cross");
  });
});

describe("row menu", () => {
  const menuItems = () => screen.queryAllByRole("button").filter((b) => b.className.includes("um-menu__item")).map((b) => b.textContent);

  test("each row has View and a More actions button named after the user", async () => {
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.getByRole("button", { name: "View Ana Cruz" })).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "More actions for Ana Cruz" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("the menu holds the right actions for each state", async () => {
    rows = [
      jobseeker({ _id: "a", name: "Active One" }),
      jobseeker({ _id: "b", name: "Suspended One", isActive: false, accountStatus: "suspended" }),
      jobseeker({ _id: "d", name: "Deleted One", isActive: false, deletedAt: "2026-05-01T00:00:00Z" }),
    ];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Active One");

    await user.click(screen.getByRole("button", { name: "More actions for Active One" }));
    expect(menuItems()).toEqual(["Deactivate"]);

    await user.click(screen.getByRole("button", { name: "More actions for Suspended One" }));
    expect(menuItems()).toEqual(["Reactivate", "Delete"]);

    await user.click(screen.getByRole("button", { name: "More actions for Deleted One" }));
    expect(menuItems()).toEqual(["Restore"]);
  });

  test("only one menu is open at a time", async () => {
    rows = [jobseeker({ _id: "a", name: "First" }), jobseeker({ _id: "b", name: "Second" })];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("First");
    const first = screen.getByRole("button", { name: "More actions for First" });
    const second = screen.getByRole("button", { name: "More actions for Second" });
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    await user.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(menuItems()).toHaveLength(1);
  });

  test("Escape closes the menu and returns focus to the More actions button", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Cruz");
    const trigger = screen.getByRole("button", { name: "More actions for Ana Cruz" });
    await user.click(trigger);
    await user.tab(); // into the menu
    expect(document.activeElement.className).toContain("um-menu__item");
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menuItems()).toEqual([]);
    expect(document.activeElement).toBe(trigger);
  });

  test("a click elsewhere closes the menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Cruz");
    const trigger = screen.getByRole("button", { name: "More actions for Ana Cruz" });
    await user.click(trigger);
    await user.click(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("Delete opens the existing delete dialog", async () => {
    rows = [jobseeker({ isActive: false, accountStatus: "suspended" })];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Cruz");
    await user.click(screen.getByRole("button", { name: "More actions for Ana Cruz" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete dialog for Ana Cruz")).toBeTruthy();
  });

  test("Restore calls the restore endpoint", async () => {
    rows = [jobseeker({ isActive: false, deletedAt: "2026-05-01T00:00:00Z" })];
    adminAPI.restoreUser.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Cruz");
    await user.click(screen.getByRole("button", { name: "More actions for Ana Cruz" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(adminAPI.restoreUser).toHaveBeenCalledWith("j1"));
  });
});

describe("layout by width", () => {
  test("desktop: a table, no Filters button, page size 20", async () => {
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(lastParams().limit).toBe(20);
    expect(lastParams().details).toBe("true");
  });

  test("phone: cards instead of a table, a smaller page, and a Filters button that opens the panel", async () => {
    setViewport(390);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("list", { name: "Accounts" })).toBeTruthy();
    expect(lastParams().limit).toBe(4);

    // the search box stays; the rest is behind the button
    expect(screen.getByLabelText("Search")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /^Filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Export CSV/ })).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Status")).toBeTruthy();
    expect(screen.getByLabelText("Sort by")).toBeTruthy();
    expect(screen.getByRole("button", { name: /No email/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeTruthy();
  });

  test("phone: the Filters button counts the active filters", async () => {
    setViewport(390);
    renderPage("/admin/users?tab=jobseekers&status=suspended&noEmail=1");
    await screen.findByText("Ana Cruz");
    expect(screen.getByRole("button", { name: "Filters, 2 active" })).toBeTruthy();
  });

  test("phone: a card carries the name, status, key info, dates and both buttons", async () => {
    setViewport(320);
    renderPage();
    const card = (await screen.findByText("Ana Cruz")).closest("li");
    const scope = within(card);
    expect(scope.getByText("Profile 80%")).toBeTruthy();
    expect(scope.getByText("4 applications")).toBeTruthy();
    expect(scope.getByText(/Last active:/)).toBeTruthy();
    expect(scope.getByRole("button", { name: "View Ana Cruz" })).toBeTruthy();
    expect(scope.getByRole("button", { name: "More actions for Ana Cruz" })).toBeTruthy();
  });
});

describe("pending staff invitations", () => {
  test("a count above zero shows the notice; zero or no staff counts shows nothing", async () => {
    adminAPI.getUserDirectoryCounts.mockResolvedValue({ data: { ...COUNTS, staff: { pendingActivation: 2 } } });
    renderPage();
    expect(await screen.findByRole("button", { name: /2 staff accounts pending activation/ })).toBeTruthy();
  });

  test("without staff counts there is no notice", async () => {
    renderPage();
    await screen.findByText("Ana Cruz");
    expect(screen.queryByRole("button", { name: /pending activation/ })).toBeNull();
  });
});
