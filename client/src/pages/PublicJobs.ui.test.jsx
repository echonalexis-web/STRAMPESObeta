import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { setViewport } from "../test/viewport";

vi.mock("../services/api", () => ({
  jobAPI: { getPublicJobs: vi.fn() },
  // The catalog lists behind the Industry and Job type filters: empty, so the built-in lists are used.
  systemOptionsAPI: { list: vi.fn(async () => ({ data: [] })) },
  resolveAssetUrl: (value) => value,
}));
// The signed-in board is not under test here.
vi.mock("./JobBoard", () => ({ default: () => <div>signed-in job board</div> }));
vi.mock("../routes/JobVacancyAgeGate", () => ({ JobVacancyAgeGate: ({ children }) => children }));

const { jobAPI } = await import("../services/api");
const { default: PublicJobs } = await import("./PublicJobs");
const { default: JobBoard } = await import("./JobBoard");
const { ProtectedRoute } = await import("../routes/ProtectedRoute");
const { JobVacancyAgeGate } = await import("../routes/JobVacancyAgeGate");

const job = (n, over = {}) => ({
  _id: String(n).padStart(24, "0"),
  title: `Welder ${n}`,
  description: "d",
  qualifications: [],
  industry: ["Construction"],
  jobType: "Full-time",
  location: "Boac, Marinduque",
  salary: "15000",
  slots: 2,
  createdAt: new Date().toISOString(),
  employer: { companyName: "Acme Marinduque", profileImage: null },
  ...over,
});

function LoginProbe() {
  const location = useLocation();
  return <div data-testid="login-page">{JSON.stringify(location.state)}</div>;
}

const visitor = { user: null, token: null, loading: false };
const renderAt = (url = "/jobs", auth = visitor) =>
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          {/* The same route definition App.jsx uses for /jobs. */}
          <Route
            path="/jobs"
            element={
              <ProtectedRoute requiredRole="jobseeker" visitorFallback={<PublicJobs />}>
                <JobVacancyAgeGate><JobBoard /></JobVacancyAgeGate>
              </ProtectedRoute>
            }
          />
          <Route path="/jobs/:id" element={<div>job detail page</div>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  setViewport(1280);
  jobAPI.getPublicJobs.mockResolvedValue({
    data: { jobs: [job(1), job(2)], total: 2, pagination: { total: 2, page: 1, pages: 1, limit: 9 } },
  });
});

describe("the public jobs list", () => {
  test("See More Jobs lands on the list for a visitor: no login redirect, newest-first request, 9 per page", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { level: 1, name: "Available jobs" })).toBeTruthy();
    expect(screen.queryByTestId("login-page")).toBeNull();
    expect(screen.queryByText("signed-in job board")).toBeNull();
    expect(await screen.findByText("Welder 1")).toBeTruthy();
    const params = jobAPI.getPublicJobs.mock.calls[0][0];
    expect(params).toMatchObject({ page: 1, limit: 9 });
    expect(params.sortBy).toBeUndefined(); // the server default is newest first
  });

  test("a signed-in jobseeker still gets the Browse Jobs board", async () => {
    renderAt("/jobs", { user: { role: "jobseeker" }, token: "t", loading: false });
    expect(await screen.findByText("signed-in job board")).toBeTruthy();
    expect(jobAPI.getPublicJobs).not.toHaveBeenCalled();
  });

  test("the result count is a polite live region and the pager is always there", async () => {
    renderAt();
    await screen.findByText("Welder 1");
    const live = screen.getAllByRole("status").find((el) => /2 jobs/i.test(el.textContent));
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("navigation", { name: /pagination|jobs/i })).toBeTruthy();
  });

  test("filters from the URL are sent, with the page", async () => {
    renderAt("/jobs?q=welder&location=Boac&page=2");
    await screen.findByText("Welder 1");
    expect(jobAPI.getPublicJobs.mock.calls[0][0]).toMatchObject({ q: "welder", location: "Boac", page: 2, limit: 9 });
  });
});

describe("login-gated actions", () => {
  test("a card shows Log in to apply, never Apply now, and sends the visitor to login with a return to that job", async () => {
    const user = userEvent.setup();
    renderAt();
    const buttons = await screen.findAllByRole("button", { name: "Log in to apply" });
    expect(buttons.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Apply now$/ })).toBeNull();
    expect(screen.queryByText(/% match/i)).toBeNull();
    await user.click(buttons[0]);
    const probe = await screen.findByTestId("login-page");
    expect(JSON.parse(probe.textContent)).toEqual({ from: `/jobs/${"1".padStart(24, "0")}` });
  });

  test("the page-level Log in button returns to this same list, filters included", async () => {
    const user = userEvent.setup();
    renderAt("/jobs?q=welder");
    await screen.findByText("Welder 1");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    const probe = await screen.findByTestId("login-page");
    expect(JSON.parse(probe.textContent).from).toMatch(/^\/jobs\?q=welder/);
  });

  test("no applicant counts or company links are shown to a visitor", async () => {
    renderAt();
    await screen.findByText("Welder 1");
    expect(screen.queryByText(/applicants?/i)).toBeNull();
    expect(document.querySelector('a[href^="/people/"]')).toBeNull();
  });
});

describe("empty and error states", () => {
  test("no matches shows the message and Clear filters, which starts over", async () => {
    const user = userEvent.setup();
    jobAPI.getPublicJobs.mockResolvedValueOnce({ data: { jobs: [], total: 0, pagination: { total: 0, page: 1, pages: 1, limit: 9 } } });
    renderAt("/jobs?q=zzzz");
    // The message is in the result count (live region) and in the empty state itself.
    expect((await screen.findAllByText("No jobs match your search")).length).toBeGreaterThanOrEqual(2);
    const clear = screen.getByRole("button", { name: "Clear filters" });
    await user.click(clear);
    await waitFor(() => expect(jobAPI.getPublicJobs).toHaveBeenCalledTimes(2));
    expect(jobAPI.getPublicJobs.mock.calls[1][0].q).toBeUndefined();
    expect(await screen.findByText("Welder 1")).toBeTruthy();
  });

  test("an error shows a message with Try again, which retries", async () => {
    const user = userEvent.setup();
    jobAPI.getPublicJobs.mockRejectedValueOnce({ response: { status: 429, data: { message: "Too many requests. Please wait a minute and try again." } } });
    renderAt();
    expect(await screen.findByText("Too many requests. Please wait a minute and try again.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("Welder 1")).toBeTruthy();
  });
});
