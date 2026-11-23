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
  authAPI: { getProfile: vi.fn(), uploadGeneratedResume: vi.fn() },
  jobAPI: { getApplyContext: vi.fn(), getJobById: vi.fn() },
  jobseekerDocumentAPI: { upload: vi.fn(), list: vi.fn() },
  resumePhotoAPI: { info: vi.fn(), image: vi.fn(), put: vi.fn(), remove: vi.fn() },
}));

const { authAPI, jobAPI, jobseekerDocumentAPI, resumePhotoAPI } = await import("../services/api");
const { exportHtmlNodeToPdf, renderHtmlNodeToPdfBlob } = await import("../utils/exportUtils");
const { renderAtsPdfBlob } = await import("../utils/atsPdf");
const { default: ResumeStudio } = await import("./ResumeStudio");

const JOB_ID = "507f1f77bcf86cd799439011";
const job = (over = {}) => ({ _id: JOB_ID, title: "Service Crew", companyName: "Acme Foods", hiringManagerName: "Maria Santos", location: "Boac, Marinduque", ...over });
const profileResponse = () => ({
  data: {
    user: {
      firstName: "Ana", surname: "Cruz", email: "ana@example.test", desiredJobTitle: "Cook", workExperience: "1–3 years",
      skills: ["Cooking", "Teamwork", "Customer Service"], profileImage: "https://profile.example/avatar.png",
    },
    profile: { skills: [], workHistory: [{ position: "Kitchen helper", companyName: "Corner Cafe" }] },
  },
});

function Probe() {
  const location = useLocation();
  return <pre data-testid="probe">{`${location.pathname}${location.search}|${JSON.stringify(location.state)}`}</pre>;
}

const APPLY_QUERY = `?jobId=${JOB_ID}&returnTo=${encodeURIComponent("/jobs?q=cook&page=2")}`;
const renderStudio = (query = APPLY_QUERY) =>
  render(
    <MemoryRouter initialEntries={[`/profile/resume${query}`]}>
      <Routes>
        <Route path="/profile/resume" element={<ResumeStudio />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );

const canvasOf = () => screen.getByLabelText(/^(Cover letter|Resume)$/);
const primary = (name) => screen.getByRole("button", { name });
const applyingReady = () => screen.findByText("Service Crew");
const photoBlob = () => ({ data: new Blob(["img"], { type: "image/webp" }) });
const withPhoto = () => {
  resumePhotoAPI.info.mockResolvedValue({ data: { hasPhoto: true, name: "me.jpg" } });
  resumePhotoAPI.image.mockResolvedValue(photoBlob());
};
const toReview = async (user) => {
  await user.click(primary("Next: Cover letter"));
  await user.click(primary("Next: Review"));
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout; the shared modal hook needs something "rendered" to focus.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  authAPI.getProfile.mockResolvedValue(profileResponse());
  jobAPI.getApplyContext.mockResolvedValue({ data: { job: job() } });
  jobAPI.getJobById.mockResolvedValue({ data: { checklistMatch: { items: [{ type: "skill", value: "Customer Service", met: true }] } } });
  jobseekerDocumentAPI.upload.mockImplementation(async ({ kind, title }) => ({ data: { _id: kind === "resume" ? "res-1" : "let-1", title } }));
  renderHtmlNodeToPdfBlob.mockResolvedValue(new Blob(["%PDF-image"], { type: "application/pdf" }));
  renderAtsPdfBlob.mockReturnValue(new Blob(["%PDF-text"], { type: "application/pdf" }));
  resumePhotoAPI.info.mockResolvedValue({ data: { hasPhoto: false } });
  resumePhotoAPI.image.mockResolvedValue(photoBlob());
  resumePhotoAPI.put.mockResolvedValue({ data: { hasPhoto: true, name: "new.jpg" } });
  resumePhotoAPI.remove.mockResolvedValue({ data: { hasPhoto: false } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("action bar and steps (applying mode)", () => {
  test("one bar: Back, the job, the save status as text, three steps and ONE primary button; no tab row, no page title", async () => {
    renderStudio();
    await applyingReady();
    expect(screen.getByText("Applying to")).toBeTruthy();
    expect(screen.getByText(/Acme Foods/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to Browse Jobs/ })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No changes yet");
    const steps = within(screen.getByRole("list", { name: "Application steps" })).getAllByRole("button");
    expect(steps.map((b) => b.textContent.trim())).toEqual(["1Resume", "2Cover letter", "3Review"]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "Next: Cover letter" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText("Career Studio")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume Builder|Cover Letter Generator/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Profile" })).toBeNull(); // no breadcrumb here
    expect(jobAPI.getApplyContext).toHaveBeenCalledWith(JOB_ID);
  });

  test("the primary button changes per step and the active step moves; passed steps show a check", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    const steps = () => within(screen.getByRole("list", { name: "Application steps" })).getAllByRole("button");
    await user.click(primary("Next: Cover letter"));
    expect(steps()[1].getAttribute("aria-current")).toBe("step");
    expect(steps()[0].textContent).toContain("done");
    expect(canvasOf().className).toContain("letter-doc");
    await user.click(primary("Next: Review"));
    expect(steps()[2].getAttribute("aria-current")).toBe("step");
    expect(primary("Continue to submit application")).toBeTruthy();
    // A step is a real button: back to the first one.
    await user.click(steps()[0]);
    expect(primary("Next: Cover letter")).toBeTruthy();
  });

  test("Next from the letter is blocked with an alert while the letter is empty, then while a [placeholder] is left", async () => {
    const user = userEvent.setup();
    renderStudio(`${APPLY_QUERY}&mode=coverLetter`);
    await applyingReady();
    const canvas = canvasOf();
    canvas.querySelectorAll(".letter-doc__paragraph").forEach((p) => p.remove());
    fireEvent.input(canvas);
    const next = primary("Next: Review");
    await user.click(next);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/write your cover letter/);
    expect(next.getAttribute("aria-describedby")).toBe(alert.id);
    expect(primary("Next: Review")).toBeTruthy(); // still on the letter step

    canvas.insertAdjacentHTML("beforeend", '<p class="letter-doc__paragraph">I achieved [your notable achievement].</p>');
    fireEvent.input(canvas);
    await user.click(primary("Next: Review"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/square brackets/));
  });

  test("jumping straight to Review from the first step is blocked the same way", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    // Empty out the letter while it is not on screen, through the letter step.
    await user.click(primary("Next: Cover letter"));
    const canvas = canvasOf();
    canvas.querySelectorAll(".letter-doc__paragraph").forEach((p) => p.remove());
    fireEvent.input(canvas);
    const steps = within(screen.getByRole("list", { name: "Application steps" })).getAllByRole("button");
    await user.click(steps[0]);
    await user.click(steps[2]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/write your cover letter/);
    expect(steps[2].getAttribute("aria-current")).toBeNull();
  });

  test("the letter is written for the job; the hiring contact is the salutation, else Dear Hiring Manager", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    await user.click(primary("Next: Cover letter"));
    const text = canvasOf().textContent;
    expect(text).toContain("the Service Crew position at Acme Foods");
    expect(text).toContain("Dear Maria Santos,");
    expect(text).not.toMatch(/\[[^\]]+\]|\{[a-z_]+\}/);
  });

  test("no hiring contact: Dear Hiring Manager, and no empty name line", async () => {
    const user = userEvent.setup();
    jobAPI.getApplyContext.mockResolvedValue({ data: { job: job({ hiringManagerName: "" }) } });
    renderStudio();
    await applyingReady();
    await user.click(primary("Next: Cover letter"));
    expect(canvasOf().textContent).toContain("Dear Hiring Manager,");
    expect(canvasOf().querySelector(".letter-doc__addressee")).toBeNull();
  });

  test("a job that cannot be applied to shows a message and a way back, not the studio", async () => {
    jobAPI.getApplyContext.mockRejectedValue({ response: { status: 409, data: { code: "ALREADY_APPLIED" } } });
    renderStudio();
    expect((await screen.findByRole("alert")).textContent).toBe("You have already applied to this job.");
    expect(screen.getByRole("link", { name: "Go back to Browse Jobs" }).getAttribute("href")).toBe("/jobs?q=cook&page=2");
    expect(screen.queryByRole("button", { name: /Next: Cover letter/ })).toBeNull();
  });

  test("an unsafe returnTo falls back to the jobs board", async () => {
    jobAPI.getApplyContext.mockRejectedValue({ response: { status: 404, data: { code: "JOB_NOT_FOUND" } } });
    renderStudio(`?jobId=${JOB_ID}&returnTo=${encodeURIComponent("https://evil.example/jobs")}`);
    expect((await screen.findByRole("link", { name: "Go back to Browse Jobs" })).getAttribute("href")).toBe("/jobs");
  });

  test("the resume is tailored from the applicant's own skills and says so under the page", async () => {
    renderStudio();
    await applyingReady();
    const root = canvasOf();
    expect(root.querySelector(".resume-doc__title").textContent).toBe("Service Crew");
    const skills = root.querySelector('[data-section="skills"]').textContent.replace("Skills", "");
    expect(skills.startsWith("Customer Service")).toBe(true);
    expect(screen.getByText(/Tailored to this job: your own skills are ordered/)).toBeTruthy();
  });
});

describe("Review step", () => {
  test("shows both documents with an Edit button each that goes back to that step, and the closing checks", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    await toReview(user);
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(within(resume).getByText("Resume - Service Crew - Acme Foods")).toBeTruthy();
    expect(within(resume).getByText("Standard")).toBeTruthy();
    const letter = screen.getByRole("article", { name: "Cover letter" });
    expect(within(letter).getByText("Dear Maria Santos,")).toBeTruthy();
    expect(within(letter).getByText("Service Crew · Acme Foods")).toBeTruthy();
    expect(within(letter).getByText("No unfinished [brackets] left")).toBeTruthy();
    const before = screen.getByRole("article", { name: "Before you continue" });
    expect(within(before).getAllByRole("listitem")).toHaveLength(3);
    expect(within(before).getByText(/Nothing is sent yet/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Continue to submit application" })).toHaveLength(1);

    await user.click(within(resume).getByRole("button", { name: "Edit resume" }));
    expect(primary("Next: Cover letter")).toBeTruthy();
    await user.click(primary("Next: Cover letter"));
    await user.click(primary("Next: Review"));
    await user.click(within(screen.getByRole("article", { name: "Cover letter" })).getByRole("button", { name: "Edit cover letter" }));
    expect(primary("Next: Review")).toBeTruthy();
    expect(canvasOf().className).toContain("letter-doc");
  });

  test("Continue saves a clearly named resume and cover letter and returns with the new documents handed back", async () => {
    const user = userEvent.setup();
    withPhoto();
    renderStudio();
    await applyingReady();
    await toReview(user);
    await user.click(primary("Continue to submit application"));
    const probe = await screen.findByTestId("probe");
    expect(probe.textContent.startsWith("/jobs?q=cook&page=2|")).toBe(true);
    expect(JSON.parse(probe.textContent.split("|")[1]).reopenApply).toEqual({ jobId: JOB_ID, resumeId: "res-1", coverLetterId: "let-1" });
    const calls = jobseekerDocumentAPI.upload.mock.calls.map(([arg]) => arg);
    expect(calls.map((c) => [c.kind, c.title])).toEqual([
      ["resume", "Resume - Service Crew - Acme Foods"],
      ["coverLetter", "Cover letter - Service Crew - Acme Foods"],
    ]);
    expect(calls[1].sourceJobId).toBe(JOB_ID);
    expect(calls[0]).toMatchObject({ resumeType: "standard", source: "builder", hasPhoto: true });
  });

  test("a failed save stays on the page with the server's reason", async () => {
    const user = userEvent.setup();
    jobseekerDocumentAPI.upload.mockRejectedValue({ response: { data: { message: "You can save up to 10 resumes. Delete one before adding another." } } });
    renderStudio();
    await applyingReady();
    await toReview(user);
    await user.click(primary("Continue to submit application"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/up to 10 resumes/);
    expect(screen.queryByTestId("probe")).toBeNull();
  });
});

describe("Back with and without unsaved changes", () => {
  test("no edits: Back goes straight to the board with its filters", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    expect((await screen.findByTestId("probe")).textContent).toBe("/jobs?q=cook&page=2|null");
  });

  test("after an edit the status says so and Back asks first (alertdialog): Stay, Discard, Save and go back", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    fireEvent.input(canvasOf());
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes");
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Leave without saving?" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Stay here" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByTestId("probe")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    expect((await screen.findByTestId("probe")).textContent).toBe("/jobs?q=cook&page=2|null");
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
  });

  test("Save and go back saves both documents and returns with the Apply modal state", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    fireEvent.input(canvasOf());
    await user.click(screen.getByRole("button", { name: /Back to Browse Jobs/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save and go back" }));
    const probe = await screen.findByTestId("probe");
    expect(JSON.parse(probe.textContent.split("|")[1]).reopenApply.coverLetterId).toBe("let-1");
  });
});

describe("closing the tab", () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  test("warns only while there are unsaved changes, and stops once they are saved", async () => {
    const user = userEvent.setup();
    renderStudio("");
    await screen.findByRole("heading", { level: 1 });
    expect(unload()).toBe(false);
    fireEvent.input(canvasOf());
    expect(unload()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Document" }));
    await user.click(screen.getByRole("menuitem", { name: "Save to Library" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved to library"));
    expect(unload()).toBe(false);
  });
});

describe("Document menu", () => {
  test("opens, lists Save to Library and Export (not Save to Profile when applying), closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    const button = screen.getByRole("button", { name: "Document" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Document actions" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent.trim())).toEqual(["Save to Library", "Export printable PDF"]);
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[1]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("an outside click closes it; choosing Export runs it and closes the menu", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    await user.click(screen.getByRole("button", { name: "Document" }));
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Document" }));
    await user.click(screen.getByRole("menuitem", { name: "Export printable PDF" }));
    await waitFor(() => expect(exportHtmlNodeToPdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Save to Library from the menu is blocked by a [placeholder] in the letter", async () => {
    const user = userEvent.setup();
    renderStudio(`${APPLY_QUERY}&mode=coverLetter`);
    await applyingReady();
    canvasOf().insertAdjacentHTML("beforeend", '<p class="letter-doc__paragraph">Hello [name]</p>');
    fireEvent.input(canvasOf());
    await user.click(screen.getByRole("button", { name: "Document" }));
    await user.click(screen.getByRole("menuitem", { name: "Save to Library" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/square brackets/);
    expect(jobseekerDocumentAPI.upload).not.toHaveBeenCalled();
  });
});

describe("Profile mode", () => {
  test("header with breadcrumb, title, Resume | Cover letter switch, status and ONE primary; Save to Profile is in the menu", async () => {
    const user = userEvent.setup();
    renderStudio("");
    expect(await screen.findByRole("heading", { level: 1, name: "Career Studio" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe("/profile");
    expect(screen.getByRole("group", { name: "Document" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume", pressed: true })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Application steps" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Back to Browse Jobs/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Save to Profile" })).toHaveLength(1);
    expect(jobAPI.getApplyContext).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Document" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent.trim())).toEqual([
      "Save to Library", "Save to Profile", "Export printable PDF",
    ]);
  });

  test("in cover letter mode Save to Profile is not offered at all (not shown disabled); Save to Library is the primary", async () => {
    const user = userEvent.setup();
    renderStudio("");
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Cover letter" }));
    expect(screen.queryByRole("button", { name: "Save to Profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save to Library" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Document" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Save to Profile" })).toBeNull();
  });

  test("an empty cover letter shows the dashed message inside the page", async () => {
    const user = userEvent.setup();
    renderStudio("");
    await screen.findByRole("heading", { level: 1 });
    await user.click(screen.getByRole("button", { name: "Cover letter" }));
    const empty = canvasOf().querySelector(".letter-doc__paragraph--empty");
    expect(empty.textContent).toMatch(/The cover letter is empty\. Write it here, or press Regenerate/);
  });
});

describe("settings rail", () => {
  test("resume cards in order, tone cards for the letter; the mobile toggle has aria-expanded", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    const rail = screen.getByRole("complementary", { name: "Settings" });
    expect(within(rail).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Resume type", "Look", "Resume photo", "Sections and order", "Upload a resume file instead",
    ]);
    expect(await within(rail).findByRole("button", { name: "Move Skills up" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Show settings" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide settings" }).getAttribute("aria-expanded")).toBe("true");

    await user.click(primary("Next: Cover letter"));
    const letterRail = screen.getByRole("complementary", { name: "Settings" });
    expect(within(letterRail).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Who it is for", "Tone"]);
    const tone = within(letterRail).getByRole("button", { name: /Professional & Formal/ });
    expect(tone.getAttribute("aria-pressed")).toBe("true");
    await user.click(within(letterRail).getByRole("button", { name: /Concise & Direct/ }));
    expect(within(letterRail).getByRole("button", { name: /Concise & Direct/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(letterRail).getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(within(letterRail).getByRole("button", { name: "Clear letter" })).toBeTruthy();
  });
});

describe("resume type", () => {
  test("ATS disables the looks and the photo controls, says why, and keeps a stored photo for later", async () => {
    const user = userEvent.setup();
    withPhoto();
    renderStudio();
    await applyingReady();
    await waitFor(() => expect(canvasOf().querySelector("img.resume-doc__photo")).not.toBeNull());

    await user.click(screen.getByRole("radio", { name: /ATS-friendly/ }));
    expect(screen.getByRole("radio", { name: /ATS-friendly/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Plain layout that hiring software reads accurately")).toBeTruthy();
    for (const name of [/Classic/, /Modern Sidebar/, /Executive/]) expect(screen.getByRole("button", { name }).disabled).toBe(true);
    expect(screen.getByText("ATS uses one plain look")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Remove" }).disabled).toBe(true);
    expect(screen.getByRole("switch").disabled).toBe(true);
    expect(screen.getByText(/Photos are left out of ATS resumes/)).toBeTruthy();
    expect(canvasOf().className).toContain("doc-theme--ats");
    expect(canvasOf().querySelector("img")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Standard" }));
    expect(canvasOf().querySelector("img.resume-doc__photo")).not.toBeNull(); // the stored photo came back
    expect(resumePhotoAPI.remove).not.toHaveBeenCalled();
  });

  test("an ATS resume is saved from its text, labelled ATS and with no photo flag", async () => {
    const user = userEvent.setup();
    withPhoto();
    renderStudio();
    await applyingReady();
    await user.click(screen.getByRole("radio", { name: /ATS-friendly/ }));
    await toReview(user);
    await user.click(primary("Continue to submit application"));
    await screen.findByTestId("probe");
    expect(renderAtsPdfBlob).toHaveBeenCalledTimes(1);
    const resumeCall = jobseekerDocumentAPI.upload.mock.calls.map(([arg]) => arg).find((c) => c.kind === "resume");
    expect(resumeCall).toMatchObject({ resumeType: "ats", hasPhoto: false });
    expect(renderHtmlNodeToPdfBlob).toHaveBeenCalledTimes(1); // the letter stays a standard PDF
  });
});

describe("resume photo card", () => {
  test("with no photo: a dashed drop area with a real Upload button and the note; the profile photo is not offered", async () => {
    renderStudio();
    await applyingReady();
    const card = screen.getByRole("heading", { name: "Resume photo" }).closest("section");
    expect(within(card).getByRole("button", { name: "Upload a photo" })).toBeTruthy();
    expect(within(card).getByText("or drop a photo here")).toBeTruthy();
    expect(within(card).getByText("JPG, PNG or WebP, up to 2 MB. Used only on resumes you make. Your profile photo is not changed.")).toBeTruthy();
    expect(within(card).queryByRole("switch")).toBeNull();
    expect(canvasOf().querySelector("img")).toBeNull();
  });

  test("with a photo: a thumbnail with alt text, the name, Replace, Remove and a switch that reads On or Off", async () => {
    const user = userEvent.setup();
    withPhoto();
    renderStudio();
    await applyingReady();
    const card = (await screen.findByRole("heading", { name: "Resume photo" })).closest("section");
    expect(await within(card).findByAltText("Your resume photo")).toBeTruthy();
    expect(within(card).getByText("me.jpg")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Remove" })).toBeTruthy();
    const toggle = within(card).getByRole("switch", { name: "Show photo on this resume" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.textContent).toContain("On");
    expect(canvasOf().querySelector("img.resume-doc__photo")).not.toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Off");
    expect(canvasOf().querySelector("img")).toBeNull();
  });

  test("upload: the photo is sent, comes on by default, and shows on the resume", async () => {
    const user = userEvent.setup();
    renderStudio();
    await applyingReady();
    const file = new File(["x"], "new.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("resume-photo-input"), file);
    await waitFor(() => expect(resumePhotoAPI.put).toHaveBeenCalledWith(file));
    await waitFor(() => expect(canvasOf().querySelector("img.resume-doc__photo")).not.toBeNull());
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("new.jpg")).toBeTruthy();
  });

  test("a wrong file type and an oversize file are refused on the page with an alert; nothing is sent", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderStudio();
    await applyingReady();
    const input = screen.getByTestId("resume-photo-input");
    await user.upload(input, new File(["x"], "cv.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Use a JPG, PNG or WebP photo.");
    const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 3 * 1024 * 1024 });
    await user.upload(input, big);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That photo is larger than 2 MB."));
    expect(resumePhotoAPI.put).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Upload a photo" }).getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  test("the server's refusal is shown next to the control", async () => {
    const user = userEvent.setup();
    resumePhotoAPI.put.mockRejectedValue({ response: { data: { message: "That photo is too small. Use one at least 120 pixels on each side." } } });
    renderStudio();
    await applyingReady();
    await user.upload(screen.getByTestId("resume-photo-input"), new File(["x"], "tiny.jpg", { type: "image/jpeg" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/too small/);
    expect(canvasOf().querySelector("img")).toBeNull();
  });

  test("remove deletes the stored photo, takes it off the resume and brings the upload area back", async () => {
    const user = userEvent.setup();
    withPhoto();
    renderStudio();
    await applyingReady();
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(resumePhotoAPI.remove).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Upload a photo" })).toBeTruthy();
    expect(canvasOf().querySelector("img")).toBeNull();
  });
});

describe("resume file upload", () => {
  test("a PDF is uploaded to the library and used for the application instead of a built resume", async () => {
    const user = userEvent.setup();
    jobseekerDocumentAPI.upload.mockImplementation(async ({ kind, title }) => ({ data: { _id: kind === "resume" ? "up-1" : "let-1", title } }));
    renderStudio();
    await applyingReady();
    const input = screen.getByText(/Upload a resume file instead/, { selector: "label" }).querySelector('input[type="file"]');
    await user.upload(input, new File(["%PDF-1.4"], "my-cv.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("my-cv.pdf")).toBeTruthy();
    expect(jobseekerDocumentAPI.upload.mock.calls[0][0]).toMatchObject({ kind: "resume", source: "upload", title: "my-cv.pdf" });
    await toReview(user);
    await user.click(primary("Continue to submit application"));
    const state = JSON.parse((await screen.findByTestId("probe")).textContent.split("|")[1]);
    expect(state.reopenApply.resumeId).toBe("up-1");
    expect(jobseekerDocumentAPI.upload.mock.calls.filter(([arg]) => arg.source === "builder").map(([arg]) => arg.kind)).toEqual(["coverLetter"]);
  });
});
