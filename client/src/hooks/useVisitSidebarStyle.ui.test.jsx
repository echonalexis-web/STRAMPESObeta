import { beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { useNavbarStylePreference } from "./useNavbarStylePreference";
import { isStudioPath, useVisitSidebarStyle } from "./useVisitSidebarStyle";

const USER = "user-1";
const KEY = `navbarStyle_${USER}`;

// The same wiring the Navbar uses: the saved preference, with the studio route forcing the rail.
function Rail() {
  const location = useLocation();
  const [saved, save] = useNavbarStylePreference(USER);
  const [style, setStyle] = useVisitSidebarStyle({ forced: isStudioPath(location.pathname), savedStyle: saved, saveStyle: save });
  return (
    <div>
      <output data-testid="style">{style}</output>
      <button type="button" onClick={() => setStyle(style === "icons" ? "full" : "icons")}>toggle</button>
      <Link to="/profile/resume?jobId=1">studio</Link>
      <Link to="/jobs">jobs</Link>
    </div>
  );
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Rail />
    </MemoryRouter>,
  );
const style = () => screen.getByTestId("style").textContent;

beforeEach(() => localStorage.clear());

describe("sidebar in the studio", () => {
  test("which paths count as the studio", () => {
    expect(isStudioPath("/profile/resume")).toBe(true);
    expect(isStudioPath("/profile/resume/")).toBe(true);
    expect(isStudioPath("/profile")).toBe(false);
    expect(isStudioPath("/profile/resumes")).toBe(false);
  });

  test("entering the studio collapses an expanded sidebar; leaving brings it back", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, "full");
    renderAt("/jobs");
    expect(style()).toBe("full");
    await user.click(screen.getByRole("link", { name: "studio" }));
    expect(style()).toBe("icons");
    await user.click(screen.getByRole("link", { name: "jobs" }));
    expect(style()).toBe("full");
    expect(localStorage.getItem(KEY)).toBe("full"); // the saved preference was never touched
  });

  test("a direct load of the studio (a refresh) starts collapsed, with nothing saved", () => {
    localStorage.setItem(KEY, "full");
    renderAt("/profile/resume?jobId=1");
    expect(style()).toBe("icons");
    expect(localStorage.getItem(KEY)).toBe("full");
  });

  test("expanding inside the studio lasts this visit only: not saved, and the next entry collapses again", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, "full");
    renderAt("/profile/resume");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(style()).toBe("full");
    expect(localStorage.getItem(KEY)).toBe("full"); // unchanged, not written by the visit choice
    await user.click(screen.getByRole("link", { name: "jobs" }));
    await user.click(screen.getByRole("link", { name: "studio" }));
    expect(style()).toBe("icons");
  });

  test("someone who had it collapsed stays collapsed after leaving", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, "icons");
    renderAt("/profile/resume");
    expect(style()).toBe("icons");
    await user.click(screen.getByRole("button", { name: "toggle" })); // expand for this visit
    expect(style()).toBe("full");
    await user.click(screen.getByRole("link", { name: "jobs" }));
    expect(style()).toBe("icons");
    expect(localStorage.getItem(KEY)).toBe("icons");
  });

  test("outside the studio the toggle still saves the preference as before", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, "full");
    renderAt("/jobs");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(style()).toBe("icons");
    expect(localStorage.getItem(KEY)).toBe("icons");
  });
});
