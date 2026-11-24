import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "../i18n";
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
    expect(screen.getByText("Lead Programmer & Lead Systems Analyst")).toBeTruthy();
  });

  it("redirects an unknown slug to the About page", () => {
    renderAt("/about/team/nobody");
    expect(screen.getByText("about page")).toBeTruthy();
  });

  it("hides empty sections and the glance strip for a member with null fields", () => {
    renderAt("/about/team/jake-romar-sescar");
    for (const name of [/^notable projects$/i, /^awards and achievements$/i, /^extracurricular activities$/i, /^certificates$/i, /^fun fact$/i]) {
      expect(screen.queryByRole("heading", { name })).toBeNull();
    }
    expect(screen.queryByRole("navigation", { name: /at a glance/i })).toBeNull();
    expect(screen.queryByText(/in their own words/i)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("folds the CISCO certificates into one collapsed group of 6", () => {
    renderAt("/about/team/alexis-echon");
    const group = screen.getByRole("button", { name: /^CISCO · 6 certificates · 2024–2025/ });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Network Defense")).toBeTruthy();
  });

  it("renders hero, body and pager inside the shared container", () => {
    const { container } = renderAt("/about/team/alexis-echon");
    const inWrap = (sel) => container.querySelector(sel)?.closest(".tp-wrap");
    for (const sel of [".tp-hero__grid", ".tp-layout", ".tp-pager"]) expect(inWrap(sel)).toBeTruthy();
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
    const savedLinks = TEAM_MEMBERS[1].links;
    TEAM_MEMBERS[1].links = { github: "javascript:alert(1)", linkedin: "https://example.com/in/x" };
    renderAt("/about/team/alexis-echon");
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("LinkedIn").closest("a").getAttribute("href")).toBe("https://example.com/in/x");
    TEAM_MEMBERS[1].links = savedLinks;
  });
});
