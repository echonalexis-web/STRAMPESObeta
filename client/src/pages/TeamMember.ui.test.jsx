import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamMember from "./TeamMember";
import { TEAM_MEMBERS, neighborsOf, profileSections } from "../data/teamMembers";

vi.mock("../components/SiteFooter", () => ({ default: () => <footer /> }));

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/about/team/:slug" element={<TeamMember />} />
        <Route path="/about" element={<div>about page</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  window.scrollTo = vi.fn();
});

describe("TeamMember page", () => {
  it("shows the member for a known slug", () => {
    renderAt("/about/team/alexis-echon");
    expect(screen.getByRole("heading", { level: 1, name: "Alexis Echon" })).toBeTruthy();
    expect(screen.getByText("Lead Developer")).toBeTruthy();
  });

  it("redirects an unknown slug to the About page", () => {
    renderAt("/about/team/nobody");
    expect(screen.getByText("about page")).toBeTruthy();
  });

  it("hides sections that have no data", () => {
    const saved = {};
    const m = TEAM_MEMBERS.find((x) => x.slug === "ivy-cruzado");
    for (const k of ["school", "links", "certifications", "funFact"]) { saved[k] = m[k]; delete m[k]; }
    renderAt("/about/team/ivy-cruzado");
    expect(screen.queryByText(/certifications/i)).toBeNull();
    expect(screen.queryByText(/^school$/i)).toBeNull();
    expect(screen.queryByText(/^links$/i)).toBeNull();
    Object.assign(m, saved);
  });

  it("links to the previous and next member, wrapping around", () => {
    const first = TEAM_MEMBERS[0];
    const last = TEAM_MEMBERS[TEAM_MEMBERS.length - 1];
    expect(neighborsOf(first.slug).prev.slug).toBe(last.slug);
    expect(neighborsOf(last.slug).next.slug).toBe(first.slug);
  });

  it("reports which sections have data", () => {
    const s = profileSections({ intro: "hi", links: { github: "" }, school: { name: "X" } });
    expect(s.intro).toBe(true);
    expect(s.school).toBe(true);
    expect(s.links).toBe(false);
    expect(s.expertise).toBe(false);
  });

  it("never renders a non-http link", () => {
    TEAM_MEMBERS[1].links = { github: "javascript:alert(1)", linkedin: "https://example.com/in/x" };
    renderAt("/about/team/alexis-echon");
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("LinkedIn").closest("a").getAttribute("href")).toBe("https://example.com/in/x");
    delete TEAM_MEMBERS[1].links;
  });
});
