import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

vi.mock("../services/api", () => ({
  jobAPI: { getPublicJobs: vi.fn() },
  resolveAssetUrl: (value) => value,
}));
// The signed-in heart is not under test here.
vi.mock("./JobFavoriteButton", () => ({ default: () => <button type="button">saved heart</button> }));

const { jobAPI } = await import("../services/api");
const { default: HomeJobsCarousel } = await import("./HomeJobsCarousel");

const job = (n, over = {}) => ({
  _id: String(n).padStart(24, "0"),
  title: `Welder ${n}`,
  jobType: "Full-time",
  location: "Boac, Marinduque",
  salary: "PHP 20,000",
  slots: 2,
  createdAt: new Date().toISOString(),
  employer: { companyName: "Acme Marinduque", profileImage: null },
  ...over,
});
const respond = (jobs, total) => ({ data: { jobs, total, pagination: { total, page: 1, pages: 1, limit: 4 } } });

function LoginProbe() {
  const location = useLocation();
  return <div data-testid="login-page">{JSON.stringify(location.state)}</div>;
}
const visitor = { user: null, token: null, loading: false };
const renderCarousel = (auth = visitor) =>
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeJobsCarousel />} />
          <Route path="/jobs" element={<div>public jobs list</div>} />
          <Route path="/jobs/:id" element={<div>job detail page</div>} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

beforeEach(() => {
  window.HTMLElement.prototype.scrollBy = vi.fn();
  jobAPI.getPublicJobs.mockResolvedValue(respond([job(1), job(2), job(3), job(4)], 9));
});

describe("more than 4 jobs", () => {
  test("4 job cards then a See more card with the right count, linking to the full list", async () => {
    renderCarousel();
    expect(await screen.findByText("Welder 1")).toBeTruthy();
    expect(jobAPI.getPublicJobs.mock.calls[0][0]).toEqual({ limit: 4, sortBy: "newest" });
    for (const n of [1, 2, 3, 4]) expect(screen.getByText(`Welder ${n}`)).toBeTruthy();
    const more = screen.getByRole("link", { name: /5 more openings/ });
    expect(more.getAttribute("href")).toBe("/jobs");
    expect(within(more).getByText("See all available jobs")).toBeTruthy();
    expect(screen.getByText("4 newest of 9 openings")).toBeTruthy();
  });

  test("the carousel is a labelled region and each slide says where it is", async () => {
    renderCarousel();
    await screen.findByText("Welder 1");
    const region = screen.getByRole("region", { name: "Latest job openings" });
    expect(region.getAttribute("aria-roledescription")).toBe("carousel");
    const slides = region.querySelectorAll('[aria-roledescription="slide"]');
    expect(slides).toHaveLength(5);
    expect(slides[0].getAttribute("aria-label")).toBe("1 of 5");
    expect(slides[4].getAttribute("aria-label")).toBe("5 of 5");
  });

  test("previous and next are real buttons with names; there is no autoplay", async () => {
    renderCarousel();
    await screen.findByText("Welder 1");
    expect(screen.getByRole("button", { name: "Previous jobs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next jobs" })).toBeTruthy();
    expect(screen.getByText(/1 to \d of 5/)).toBeTruthy();
    expect(window.HTMLElement.prototype.scrollBy).not.toHaveBeenCalled();
  });

  test("the arrow keys scroll the track by one card", async () => {
    const user = userEvent.setup();
    renderCarousel();
    await screen.findByText("Welder 1");
    screen.getByRole("group", { name: /Job openings\. Use the left and right arrow keys/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(window.HTMLElement.prototype.scrollBy).toHaveBeenCalledTimes(1);
    expect(window.HTMLElement.prototype.scrollBy.mock.calls[0][0].left).toBeGreaterThanOrEqual(0);
  });
});

describe("4 jobs or fewer", () => {
  test("no See more card, no arrows, and a Browse all jobs link instead", async () => {
    jobAPI.getPublicJobs.mockResolvedValue(respond([job(1), job(2), job(3), job(4)], 4));
    renderCarousel();
    await screen.findByText("Welder 1");
    expect(screen.queryByText("See all available jobs")).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous jobs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next jobs" })).toBeNull();
    expect(screen.getByRole("link", { name: "Browse all jobs" }).getAttribute("href")).toBe("/jobs");
    expect(screen.getByText("4 openings")).toBeTruthy();
  });

  test("a single job reads as 1 opening", async () => {
    jobAPI.getPublicJobs.mockResolvedValue(respond([job(1)], 1));
    renderCarousel();
    await screen.findByText("Welder 1");
    expect(screen.getByText("1 opening")).toBeTruthy();
  });
});

describe("empty and error", () => {
  test("a fresh system with no jobs shows the empty state and no carousel", async () => {
    jobAPI.getPublicJobs.mockResolvedValue(respond([], 0));
    renderCarousel();
    expect(await screen.findByText("No openings right now")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Latest job openings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next jobs" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse all jobs" })).toBeNull();
  });

  test("a failed request shows an error with Try again, never a broken carousel", async () => {
    const user = userEvent.setup();
    jobAPI.getPublicJobs.mockRejectedValueOnce(new Error("network"));
    renderCarousel();
    expect(await screen.findByText("We couldn't load the latest jobs")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Latest job openings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("Welder 1")).toBeTruthy();
    expect(jobAPI.getPublicJobs).toHaveBeenCalledTimes(2);
  });
});

describe("cards", () => {
  test("a card has a job type chip, no Open badge, and one View details button (no Log in to apply)", async () => {
    renderCarousel();
    await screen.findByText("Welder 1");
    expect(screen.getAllByText("Full-time").length).toBe(4);
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.queryByRole("button", { name: /log in to apply/i })).toBeNull();
    const buttons = screen.getAllByRole("button", { name: /View details for Welder/ });
    expect(buttons).toHaveLength(4);
  });

  test("View details opens that job", async () => {
    const user = userEvent.setup();
    renderCarousel();
    await screen.findByText("Welder 1");
    await user.click(screen.getByRole("button", { name: "View details for Welder 2" }));
    expect(await screen.findByText("job detail page")).toBeTruthy();
  });

  test("an employer with no name gets a neutral label, never the bare word Employer", async () => {
    jobAPI.getPublicJobs.mockResolvedValue(respond([job(1, { employer: { companyName: "", profileImage: null } })], 1));
    renderCarousel();
    await screen.findByText("Welder 1");
    expect(screen.getByText("Hiring employer")).toBeTruthy();
    expect(screen.queryByText(/^Employer$/)).toBeNull();
  });

  test("long titles and places carry the full text in a title attribute", async () => {
    const long = "Senior Welding and Fabrication Supervisor for the Marinduque Provincial Infrastructure Program";
    jobAPI.getPublicJobs.mockResolvedValue(respond([job(1, { title: long })], 1));
    renderCarousel();
    expect(await screen.findByText(long)).toBeTruthy();
    expect(screen.getByText(long).getAttribute("title")).toBe(long);
  });
});

describe("saving a job", () => {
  test("the heart stays visible for a visitor and opens the log in prompt, which returns to Home after login", async () => {
    const user = userEvent.setup();
    renderCarousel();
    await screen.findByText("Welder 1");
    const hearts = screen.getAllByRole("button", { name: "Log in to save this job" });
    expect(hearts).toHaveLength(4);
    await user.click(hearts[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Log in to save jobs")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Log in" }));
    const probe = await screen.findByTestId("login-page");
    expect(JSON.parse(probe.textContent)).toEqual({ from: "/#available-jobs" });
  });

  test("Not now closes the prompt without leaving the page", async () => {
    const user = userEvent.setup();
    renderCarousel();
    await screen.findByText("Welder 1");
    await user.click(screen.getAllByRole("button", { name: "Log in to save this job" })[0]);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Welder 1")).toBeTruthy();
  });

  test("a signed-in user gets the normal save heart, not the prompt", async () => {
    renderCarousel({ user: { role: "jobseeker" }, token: "t", loading: false });
    await screen.findByText("Welder 1");
    expect(screen.queryByRole("button", { name: "Log in to save this job" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "saved heart" })).toHaveLength(4);
  });
});
