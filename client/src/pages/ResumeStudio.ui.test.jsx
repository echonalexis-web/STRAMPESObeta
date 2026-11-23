import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../components/feedback/context", () => ({ useToast: () => toast }));
vi.mock("../utils/exportUtils", () => ({
  exportHtmlNodeToPdf: vi.fn(),
  renderHtmlNodeToPdfBlob: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("../utils/atsPdf", () => ({ renderAtsPdfBlob: vi.fn() }));
vi.mock("../services/api", () => ({
  resolveAssetUrl: (value) => value,
  authAPI: { getProfile: vi.fn(), uploadGeneratedResume: vi.fn() },
  jobAPI: { getApplyContext: vi.fn(), getJobById: vi.fn() },
  jobseekerDocumentAPI: { upload: vi.fn(), list: vi.fn() },
}));

const { authAPI, jobAPI, jobseekerDocumentAPI } = await import("../services/api");
const { renderHtmlNodeToPdfBlob } = await import("../utils/exportUtils");
const { renderAtsPdfBlob } = await import("../utils/atsPdf");
const { default: ResumeStudio } = await import("./ResumeStudio");

const JOB_ID = "507f1f77bcf86cd799439011";
const job = (over = {}) => ({ _id: JOB_ID, title: "Service Crew", companyName: "Acme Foods", hiringManagerName: "Maria Santos", location: "Boac, Marinduque", ...over });
const profileResponse = (userOver = {}) => ({
  data: {
    user: {
      firstName: "Ana", surname: "Cruz", email: "ana@example.test", desiredJobTitle: "Cook", workExperience: "1–3 years",
      skills: ["Cooking", "Teamwork", "Customer Service"], profileImage: "", ...userOver,
    },
    profile: { skills: [], workHistory: [{ position: "Kitchen helper", companyName: "Corner Cafe" }] },
  },
});

function Probe() {
  const location = useLocation();
  return <pre data-testid="probe">{`${location.pathname}${location.search}|${JSON.stringify(location.state)}`}</pre>;
}

const renderStudio = (query = `?mode=coverLetter&jobId=${JOB_ID}&returnTo=${encodeURIComponent("/jobs?q=cook&page=2")}`) =>
  render(
    <MemoryRouter initialEntries={[`/profile/resume${query}`]}>
      <Routes>
        <Route path="/profile/resume" element={<ResumeStudio />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

const canvasOf = () => screen.getByLabelText(/^(Cover letter|Resume)$/);

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout; the shared modal hook needs something "rendered" to focus.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  authAPI.getProfile.mockResolvedValue(profileResponse());
  jobAPI.getApplyContext.mockResolvedValue({ data: { job: job() } });
  jobAPI.getJobById.mockResolvedValue({
    data: { checklistMatch: { items: [{ type: "skill", value: "Customer Service", met: true }] } },
  });
  jobseekerDocumentAPI.upload.mockImplementation(async ({ kind, title }) => ({ data: { _id: kind === "resume" ? "res-1" : "let-1", title } }));
  renderHtmlNodeToPdfBlob.mockResolvedValue(new Blob(["%PDF-image"], { type: "application/pdf" }));
  renderAtsPdfBlob.mockReturnValue(new Blob(["%PDF-text"], { type: "application/pdf" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio in applying mode", () => {
  test("shows who and what you are applying to, and a Back button; the letter is already written for the job", async () => {
    renderStudio();
    expect(await screen.findByText("Applying to Service Crew at Acme Foods")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to Browse Jobs/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to submit application" })).toBeTruthy();
    expect(jobAPI.getApplyContext).toHaveBeenCalledWith(JOB_ID);
    const letter = canvasOf().textContent;
    expect(letter).toContain("the Service Crew position at Acme Foods");
    expect(letter).not.toMatch(/\[[^\]]+\]|\{[a-z_]+\}/);
  });

  test("salutation: the hiring contact's name when the job has one, else Dear Hiring Manager", async () => {
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    expect(canvasOf().textContent).toContain("Dear Maria Santos,");
  });

  test("no hiring contact: Dear Hiring Manager, and no empty name line", async () => {
    jobAPI.getApplyContext.mockResolvedValue({ data: { job: job({ hiringManagerName: "" }) } });
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    expect(canvasOf().textContent).toContain("Dear Hiring Manager,");
    expect(canvasOf().querySelector(".letter-doc__addressee")).toBeNull();
  });

  test("a job that cannot be applied to shows a message and a way back, not the studio", async () => {
    jobAPI.getApplyContext.mockRejectedValue({ response: { status: 409, data: { code: "ALREADY_APPLIED" } } });
    renderStudio();
    expect((await screen.findByRole("alert")).textContent).toBe("You have already applied to this job.");
    expect(screen.getByRole("link", { name: "Go back to Browse Jobs" }).getAttribute("href")).toBe("/jobs?q=cook&page=2");
    expect(screen.queryByRole("button", { name: "Continue to submit application" })).toBeNull();
    expect(authAPI.getProfile).toHaveBeenCalled();
  });

  test("an unsafe returnTo falls back to the jobs board", async () => {
    jobAPI.getApplyContext.mockRejectedValue({ response: { status: 404, data: { code: "JOB_NOT_FOUND" } } });
    renderStudio(`?jobId=${JOB_ID}&returnTo=${encodeURIComponent("https://evil.example/jobs")}`);
    const link = await screen.findByRole("link", { name: "Go back to Browse Jobs" });
    expect(link.getAttribute("href")).toBe("/jobs");
  });

  test("the resume is tailored from the applicant's own skills: the job's skills first, a headline with the job title, nothing added", async () => {
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    const root = canvasOf();
    expect(root.querySelector(".resume-doc__title").textContent).toBe("Service Crew");
    const skills = root.querySelector('[data-section="skills"]').textContent.replace("Skills", "");
    expect(skills.startsWith("Customer Service")).toBe(true);
    expect(skills).toContain("Cooking");
    expect(skills).toContain("Teamwork");
    expect(root.querySelector("mark.resume-doc__match").textContent).toBe("Customer Service");
  });
});

describe("Continue to submit application", () => {
  test("is blocked, with a message tied to the button, while a [placeholder] is left in the letter; nothing is saved or left", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    const canvas = canvasOf();
    canvas.querySelector(".letter-doc__paragraph").textContent = "I achieved [your notable achievement] last year.";
    fireEvent.input(canvas);
    const button = screen.getByRole("button", { name: "Continue to submit application" });
    await user.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/square brackets/);
    expect(button.getAttribute("aria-describedby")).toBe(alert.id);
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("an empty letter is blocked too, and Save to Library is blocked by a placeholder", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    const canvas = canvasOf();
    canvas.querySelectorAll(".letter-doc__paragraph").forEach((p) => p.remove());
    fireEvent.input(canvas);
    await user.click(screen.getByRole("button", { name: "Continue to submit application" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/write your cover letter/);

    canvas.insertAdjacentHTML("beforeend", '<p class="letter-doc__paragraph">Hello [name]</p>');
    fireEvent.input(canvas);
    await user.click(screen.getByRole("button", { name: /Save to Library/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/square brackets/));
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
  });

  test("saves a clearly named resume and cover letter, then returns with the new documents handed back (nothing submitted)", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.click(screen.getByRole("button", { name: "Continue to submit application" }));
    const probe = await screen.findByTestId("probe");
    expect(probe.textContent.startsWith("/jobs?q=cook&page=2|")).toBe(true);
    const state = JSON.parse(probe.textContent.split("|")[1]);
    expect(state.reopenApply).toEqual({ jobId: JOB_ID, resumeId: "res-1", coverLetterId: "let-1" });

    const calls = jobseekerDocumentAPI.upload.mock.calls.map(([arg]) => arg);
    expect(calls.map((c) => [c.kind, c.title])).toEqual([
      ["resume", "Resume - Service Crew - Acme Foods"],
      ["coverLetter", "Cover letter - Service Crew - Acme Foods"],
    ]);
    expect(calls[1].sourceJobId).toBe(JOB_ID);
    expect(calls[0].resumeType).toBe("standard");
    expect(calls[0].source).toBe("builder");
  });

  test("a failed save stays on the page with the server's reason", async () => {
    const user = userEvent.setup();
    jobseekerDocumentAPI.upload.mockRejectedValue({ response: { data: { message: "You can save up to 10 resumes. Delete one before adding another." } } });
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.click(screen.getByRole("button", { name: "Continue to submit application" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/up to 10 resumes/);
    expect(screen.queryByTestId("probe")).toBeNull();
  });
});

describe("Back with unsaved changes", () => {
  test("no edits: Back goes straight to the board", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    expect((await screen.findByTestId("probe")).textContent).toBe("/jobs?q=cook&page=2|null");
  });

  test("after an edit, Back asks first: Stay keeps you here, Discard leaves", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    fireEvent.input(canvasOf());
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Leave without saving?" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("probe")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard" }));
    expect((await screen.findByTestId("probe")).textContent).toBe("/jobs?q=cook&page=2|null");
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
  });

  test("Save in the dialog saves both documents and returns with the Apply modal state", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByText("Applying to Service Crew at Acme Foods");
    fireEvent.input(canvasOf());
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    const probe = await screen.findByTestId("probe");
    expect(JSON.parse(probe.textContent.split("|")[1]).reopenApply.coverLetterId).toBe("let-1");
  });
});

describe("Resume type and photo", () => {
  const photoFetch = () =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["x"], { type: "image/png" }) }));

  test("ATS-friendly selects the single ATS template, locks the photo off and says why", async () => {
    const user = userEvent.setup();
    authAPI.getProfile.mockResolvedValue(profileResponse({ profileImage: "https://img.test/me.png" }));
    photoFetch();
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");

    const toggle = screen.getByRole("checkbox", { name: "Show profile photo" });
    expect(toggle.disabled).toBe(false);
    await user.click(toggle);
    await waitFor(() => expect(canvasOf().querySelector("img.resume-doc__photo")).not.toBeNull());

    await user.click(screen.getByRole("radio", { name: /ATS-friendly/ }));
    expect(screen.getByRole("radio", { name: /ATS-friendly/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Plain layout that hiring software reads accurately")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ATS template/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Modern Sidebar/ })).toBeNull();
    expect(canvasOf().className).toContain("doc-theme--ats");
    expect(canvasOf().querySelector("img")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Show profile photo" }).disabled).toBe(true);
    expect(screen.getByText(/Not available for ATS resumes/)).toBeTruthy();
  });

  test("an ATS resume is saved from its text, labelled ATS; a standard one is drawn", async () => {
    const user = userEvent.setup();
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.click(screen.getByRole("radio", { name: /ATS-friendly/ }));
    await user.click(screen.getByRole("button", { name: "Continue to submit application" }));
    await screen.findByTestId("probe");
    expect(renderAtsPdfBlob).toHaveBeenCalledTimes(1);
    const resumeCall = jobseekerDocumentAPI.upload.mock.calls.map(([arg]) => arg).find((c) => c.kind === "resume");
    expect(resumeCall.resumeType).toBe("ats");
    // The letter is still a standard picture-based PDF.
    expect(renderHtmlNodeToPdfBlob).toHaveBeenCalledTimes(1);
  });

  test("with no profile photo the toggle is off and links to Profile", async () => {
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    expect(screen.getByRole("checkbox", { name: "Show profile photo" }).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Add one in Profile" }).getAttribute("href")).toBe("/profile");
  });

  test("a photo that cannot be loaded is not added, and the applicant is told", async () => {
    const user = userEvent.setup();
    authAPI.getProfile.mockResolvedValue(profileResponse({ profileImage: "https://img.test/me.png" }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.click(screen.getByRole("checkbox", { name: "Show profile photo" }));
    expect(await screen.findByText(/could not load your photo/)).toBeTruthy();
    expect(canvasOf().querySelector("img")).toBeNull();
  });
});

describe("Resume upload in the studio", () => {
  test("a PDF is uploaded to the library and used for the application instead of a built resume", async () => {
    const user = userEvent.setup();
    jobseekerDocumentAPI.upload.mockImplementation(async ({ kind, title }) => ({ data: { _id: kind === "resume" ? "up-1" : "let-1", title } }));
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    const file = new File(["%PDF-1.4"], "my-cv.pdf", { type: "application/pdf" });
    await user.upload(document.querySelector('input[type="file"]'), file);
    expect(await screen.findByText("my-cv.pdf")).toBeTruthy();
    expect(jobseekerDocumentAPI.upload.mock.calls[0][0]).toMatchObject({ kind: "resume", source: "upload", title: "my-cv.pdf" });

    await user.click(screen.getByRole("button", { name: "Continue to submit application" }));
    const state = JSON.parse((await screen.findByTestId("probe")).textContent.split("|")[1]);
    expect(state.reopenApply.resumeId).toBe("up-1");
    // Only the letter was generated and saved after the upload.
    expect(jobseekerDocumentAPI.upload.mock.calls.filter(([arg]) => arg.source === "builder").map(([arg]) => arg.kind)).toEqual(["coverLetter"]);
  });

  test("a wrong file type is refused on the page before anything is sent", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderStudio(`?mode=resume&jobId=${JOB_ID}`);
    await screen.findByText("Applying to Service Crew at Acme Foods");
    await user.upload(document.querySelector('input[type="file"]'), new File(["x"], "me.png", { type: "image/png" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/PDF or Word/);
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
  });
});
