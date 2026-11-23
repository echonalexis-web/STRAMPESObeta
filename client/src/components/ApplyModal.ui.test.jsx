import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("./SecureFileLink", () => ({ default: ({ children }) => <span>{children}</span> }));
vi.mock("./ApplyPhoneStep", () => ({ default: () => null }));
vi.mock("../services/api", () => ({
  displayFileName: (value) => String(value),
  jobAPI: { applyToJob: vi.fn(), updateApplication: vi.fn() },
  jobseekerDocumentAPI: { list: vi.fn() },
}));

const { jobAPI, jobseekerDocumentAPI } = await import("../services/api");
const { default: ApplyModal } = await import("./ApplyModal");

const JOB = "507f1f77bcf86cd799439011";
const OTHER_JOB = "507f1f77bcf86cd799439012";
const doc = (over) => ({ storedValue: "stored", createdAt: "2026-11-20", isPrimary: false, ...over });
const library = () => [
  doc({ _id: "r-old", kind: "resume", title: "Old resume", isPrimary: true, resumeType: "standard" }),
  doc({ _id: "r-ats", kind: "resume", title: "Resume - Service Crew - Acme Foods", resumeType: "ats" }),
  doc({ _id: "r-legacy", kind: "resume", title: "Legacy resume" }), // saved before the type existed
  doc({ _id: "c-new", kind: "coverLetter", title: "Cover letter - Service Crew - Acme Foods", sourceJobId: JOB }),
];

const open = (props = {}) =>
  render(
    <MemoryRouter initialEntries={["/jobs?q=cook&page=2"]}>
      <ApplyModal isOpen onClose={vi.fn()} jobId={JOB} job={{ _id: JOB }} {...props} />
    </MemoryRouter>,
  );

const card = (title) => screen.getByTitle(title).closest("button");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  jobseekerDocumentAPI.list.mockResolvedValue({ data: library() });
  jobAPI.applyToJob.mockResolvedValue({ data: { message: "ok" } });
});

describe("Apply modal with the Studio", () => {
  test("coming back from the Studio: the new documents for this job start picked; nothing is submitted", async () => {
    open({ preselect: { jobId: JOB, resumeId: "r-ats", coverLetterId: "c-new" } });
    await screen.findByTitle("Resume - Service Crew - Acme Foods");
    expect(card("Resume - Service Crew - Acme Foods").className).toContain("is-selected");
    expect(card("Old resume").className).not.toContain("is-selected");
    expect(card("Cover letter - Service Crew - Acme Foods").className).toContain("is-selected");
    expect(jobAPI.applyToJob).not.toHaveBeenCalled();
  });

  test("the applicant still has to press Submit, and the picked documents are what is sent", async () => {
    const user = userEvent.setup();
    open({ preselect: { jobId: JOB, resumeId: "r-ats", coverLetterId: "c-new" } });
    await screen.findByTitle("Resume - Service Crew - Acme Foods");
    await user.click(screen.getByRole("button", { name: "Submit application" }));
    await waitFor(() => expect(jobAPI.applyToJob).toHaveBeenCalledTimes(1));
    const [jobId, form] = jobAPI.applyToJob.mock.calls[0];
    expect(jobId).toBe(JOB);
    expect(form.get("resumeDocumentId")).toBe("r-ats");
    expect(form.get("coverLetterDocumentId")).toBe("c-new");
  });

  test("a hand-over for a different job is ignored: the primary resume stays picked", async () => {
    open({ preselect: { jobId: OTHER_JOB, resumeId: "r-ats", coverLetterId: "c-new" } });
    await screen.findByTitle("Old resume");
    expect(card("Old resume").className).toContain("is-selected");
    expect(card("Resume - Service Crew - Acme Foods").className).not.toContain("is-selected");
  });

  test("an id that is not in the library is ignored", async () => {
    open({ preselect: { jobId: JOB, resumeId: "gone", coverLetterId: "gone-too" } });
    await screen.findByTitle("Old resume");
    expect(card("Old resume").className).toContain("is-selected");
  });

  test("resume cards say ATS or Standard in words; an older resume reads Standard", async () => {
    open();
    await screen.findByTitle("Old resume");
    expect(within(card("Resume - Service Crew - Acme Foods")).getByText("ATS")).toBeTruthy();
    expect(within(card("Old resume")).getByText("Standard")).toBeTruthy();
    expect(within(card("Legacy resume")).getByText("Standard")).toBeTruthy();
  });

  test("the tailor links open the Studio for this job and come back to this page with its filters", async () => {
    jobseekerDocumentAPI.list.mockResolvedValue({ data: [library()[0]] }); // no tailored letter yet
    open();
    const letter = await screen.findByRole("link", { name: /Tailor a cover letter for this job/ });
    const resume = screen.getByRole("link", { name: /Tailor a resume for this job/ });
    for (const [link, mode] of [[letter, "coverLetter"], [resume, "resume"]]) {
      const url = new URL(link.getAttribute("href"), "http://x.test");
      expect(url.pathname).toBe("/profile/resume");
      expect(url.searchParams.get("mode")).toBe(mode);
      expect(url.searchParams.get("jobId")).toBe(JOB);
      expect(url.searchParams.get("returnTo")).toBe("/jobs?q=cook&page=2");
    }
  });

  test("picking an existing library document works without opening the Studio", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByTitle("Old resume");
    await user.click(card("Legacy resume"));
    expect(card("Legacy resume").className).toContain("is-selected");
    await user.click(screen.getByRole("button", { name: "Submit application" }));
    await waitFor(() => expect(jobAPI.applyToJob).toHaveBeenCalled());
    expect(jobAPI.applyToJob.mock.calls[0][1].get("resumeDocumentId")).toBe("r-legacy");
  });
});
