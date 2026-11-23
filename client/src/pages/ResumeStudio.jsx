import { formatPhoneDisplay } from "../utils/phoneIntl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FaDownload,
  FaEnvelopeOpenText,
  FaFileAlt,
  FaFolderPlus,
  FaSave,
  FaBold,
  FaItalic,
  FaUnderline,
  FaAlignLeft,
  FaAlignCenter,
  FaAlignRight,
  FaAlignJustify,
  FaListUl,
  FaListOl,
  FaUndo,
  FaRedo,
  FaPalette,
  FaHighlighter,
  FaArrowLeft,
  FaCheck,
  FaUpload,
} from "react-icons/fa";
import { authAPI, jobAPI, jobseekerDocumentAPI } from "../services/api";
import { useToast } from "../components/feedback/context";
import { exportHtmlNodeToPdf, renderHtmlNodeToPdfBlob, downloadBlob } from "../utils/exportUtils";
import {
  buildInitialResumeSections,
  buildSummaryDraft,
  formatStructuredAddress,
  fullNameOf,
  RESUME_SECTION_PRESETS,
} from "../utils/resumeDerivation";
import { buildLetterParagraphs, hasPlaceholder, salutationFor } from "../utils/coverLetterText";
import { buildProfileCoverLetterReplacements, buildJobMatchedCoverLetterReplacements, matchedSkillNames } from "../utils/coverLetterDerivation";
import { DOCUMENT_TEMPLATES, ATS_TEMPLATE, DEFAULT_TEMPLATE_KEY, getTemplateClassName } from "../data/resumeTemplates";
import { reorderSkills, tailoredHeadline, documentTitle, documentFileName } from "../utils/resumeTailoring";
import { renderAtsPdfBlob } from "../utils/atsPdf";
import { safeApplyReturnPath } from "../utils/returnTo";
import { cleanHiringManagerName } from "../utils/studioText";
import { fetchPhotoDataUrl, photoUrlOf } from "../utils/studioPhoto";
import { buildSkillsList } from "../utils/resumeDerivation";
import AppModal from "../components/AppModal";
import "../styles/resume-studio.css";

const LETTER_TONES = [
  { key: "professional", label: "Professional & Formal", description: "Standard government/corporate tone" },
  { key: "enthusiastic", label: "Enthusiastic & Passionate", description: "Highlights drive and community commitment" },
  { key: "concise", label: "Concise & Direct", description: "Brief, high-impact bullet style" },
  { key: "firstTime", label: "First Job / No Experience", description: "For fresh graduates and first-time jobseekers — leads with education and eagerness to learn" },
];

// Mirrors the section ids buildInitialResumeSections() always returns, so the
// panel can label a section purely from its data-section id once content
// lives in the canvas DOM rather than in React state.
const SECTION_TITLES = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Work Experience",
  education: "Education",
  training: "Training & Certifications",
  licenses: "Eligibility & Licenses",
  languages: "Languages",
};

const FONT_FAMILIES = [
  { value: "'Segoe UI', Helvetica, Arial, sans-serif", label: "Segoe UI" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Calibri, sans-serif", label: "Calibri" },
  { value: "Verdana, sans-serif", label: "Verdana" },
];

const FONT_SIZE_OPTIONS = [10, 11, 12, 14, 16, 18, 24];
// execCommand("fontSize") only accepts the legacy 1-7 scale, so real point
// sizes are approximated to the nearest bucket.
const FONT_SIZE_MAP = { 10: "2", 11: "2", 12: "3", 14: "4", 16: "5", 18: "6", 24: "7" };

const TOOLBAR_STATE_COMMANDS = [
  "bold",
  "italic",
  "underline",
  "justifyLeft",
  "justifyCenter",
  "justifyRight",
  "justifyFull",
  "insertUnorderedList",
  "insertOrderedList",
];

const escapeHtml = (value) => {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
};

// Plain derived text (possibly with \n\n-separated entries, e.g. multiple
// jobs) becomes one <p> per entry so it reads and edits naturally once it's
// live, contenteditable HTML instead of a static string.
const textBlockToHtml = (text) => {
  const trimmed = (text || "").trim();
  if (!trimmed) return "<p></p>";
  return trimmed
    .split(/\n\n+/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
};

// The applicant's own skills as a comma list; the ones the job asks for are marked (a light
// highlight in standard resumes, plain text in ATS ones, where the mark has no styling).
const skillsToHtml = (content, matchedSkills) => {
  const wanted = new Set((matchedSkills || []).map((skill) => String(skill).trim().toLowerCase()));
  if (!wanted.size) return textBlockToHtml(content);
  const items = String(content || "").split(",").map((skill) => skill.trim()).filter(Boolean);
  return `<p>${items
    .map((skill) => (wanted.has(skill.toLowerCase()) ? `<mark class="resume-doc__match">${escapeHtml(skill)}</mark>` : escapeHtml(skill)))
    .join(", ")}</p>`;
};

// A data: URL is the only thing that goes into the photo's src, so nothing from outside can be
// smuggled into the attribute; anything else is dropped.
const photoHtml = (photoDataUrl) =>
  /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(photoDataUrl || "")
    ? `<img class="resume-doc__photo" src="${photoDataUrl}" alt="">`
    : "";

const buildResumeHtml = ({ name, headline, contactLine, sections, photoDataUrl = "", matchedSkills = [] }) => {
  const header =
    `<div class="resume-doc__header">` +
    photoHtml(photoDataUrl) +
    `<h2>${escapeHtml(name)}</h2>` +
    `<p class="resume-doc__title">${escapeHtml(headline || "")}</p>` +
    (contactLine ? `<p class="resume-doc__contact">${escapeHtml(contactLine)}</p>` : "") +
    `</div>`;
  const body = sections
    .map(
      (section) =>
        `<div class="resume-doc__section" data-section="${section.id}"` +
        `${section.generated ? ' data-generated="true"' : ""}` +
        `${section.visible ? "" : ' style="display:none;"'}>` +
        `<h3>${escapeHtml(section.title)}</h3>` +
        (section.id === "skills" ? skillsToHtml(section.content, matchedSkills) : textBlockToHtml(section.content)) +
        `</div>`,
    )
    .join("");
  return `${header}<div class="resume-doc__main">${body}</div>`;
};

// Replaces a section's body paragraphs with newly drafted text while
// keeping its <h3> title node intact.
const setSectionDraftText = (sectionEl, text) => {
  const heading = sectionEl.querySelector("h3");
  sectionEl.innerHTML = "";
  if (heading) sectionEl.appendChild(heading);
  sectionEl.insertAdjacentHTML("beforeend", textBlockToHtml(text));
  sectionEl.dataset.generated = "true";
};

const buildLetterHtml = ({ name, contactLine, todayLabel, companyName, tone, jobTitle, hiringManagerName = "", location = "", extraReplacements = {} }) => {
  // Only the job's own title and the employer's own name go in; a missing one is left out of the
  // text (see coverLetterText.js), never replaced by a bracketed placeholder.
  const paragraphs = tone
    ? buildLetterParagraphs(tone, {
        ...(jobTitle ? { "{position}": jobTitle } : {}),
        ...(companyName ? { "{company}": companyName } : {}),
        ...extraReplacements,
      })
    : [];

  return (
    `<div class="letter-doc__sender"><strong>${escapeHtml(name)}</strong>` +
    (contactLine ? `<span>${escapeHtml(contactLine)}</span>` : "") +
    `</div>` +
    `<p class="letter-doc__date">${escapeHtml(todayLabel)}</p>` +
    (hiringManagerName ? `<p class="letter-doc__addressee">${escapeHtml(hiringManagerName)}</p>` : "") +
    (companyName ? `<p class="letter-doc__recipient">${escapeHtml(companyName)}</p>` : "") +
    (location ? `<p class="letter-doc__location">${escapeHtml(location)}</p>` : "") +
    `<p class="letter-doc__salutation">${escapeHtml(salutationFor(hiringManagerName))}</p>` +
    (paragraphs.length
      ? paragraphs.map((p) => `<p class="letter-doc__paragraph">${escapeHtml(p)}</p>`).join("")
      : `<p class="letter-doc__paragraph letter-doc__paragraph--empty">Pick a writing tone on the left, or start typing your letter here.</p>`) +
    `<p class="letter-doc__signoff">Sincerely,<br>${escapeHtml(name)}</p>`
  );
};

export default function ResumeStudio() {
  const toast = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Present only when reached from the Apply modal ("Tailor a ... for this job"): the Studio then
  // runs in "applying" mode for that job and "Back to Browse Jobs" returns to `returnTo` (only an
  // internal jobs path is ever accepted; anything else falls back to the board).
  const targetJobId = searchParams.get("jobId") || "";
  const applying = Boolean(targetJobId);
  const backPath = safeApplyReturnPath(searchParams.get("returnTo") || "") || "/jobs";
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [targetJob, setTargetJob] = useState(null);
  // The job as the apply-context check answered it ({ _id, title, companyName, hiringManagerName,
  // location }), or the reason it cannot be applied to ("JOB_NOT_FOUND" | "JOB_CLOSED" |
  // "ALREADY_APPLIED" | "CHECK_FAILED").
  const [applyJob, setApplyJob] = useState(null);
  const [blockedCode, setBlockedCode] = useState("");

  const [mode, setMode] = useState(() => (searchParams.get("mode") === "coverLetter" ? "coverLetter" : "resume"));
  const modeRef = useRef(mode);
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY);
  // "standard" | "ats". ATS locks the layout to the ATS template and turns the photo off.
  const [resumeType, setResumeType] = useState("standard");
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoState, setPhotoState] = useState(""); // "" | "loading" | "failed"
  const photoDataRef = useRef("");
  const [letterAddressee, setLetterAddressee] = useState("");
  const [uploadedResume, setUploadedResume] = useState(null); // { id, title } picked instead of the built resume
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // Unsaved changes, the leave-confirmation dialog, and what Continue / Save found missing.
  const [dirtyKinds, setDirtyKinds] = useState({ resume: false, coverLetter: false });
  const dirty = dirtyKinds.resume || dirtyKinds.coverLetter;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [blockMessage, setBlockMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [continuing, setContinuing] = useState(false);
  const savedDocsRef = useRef({}); // kind -> { signature, doc }, so pressing Save twice does not duplicate
  // `kind` is the document that changed (the one on screen unless told otherwise).
  const markDirty = (kind = modeRef.current) => {
    setDirtyKinds((prev) => (prev[kind] ? prev : { ...prev, [kind]: true }));
    setStatusMessage("");
  };
  const clearDirty = (kind) => setDirtyKinds((prev) => (kind ? { ...prev, [kind]: false } : { resume: false, coverLetter: false }));
  const [exporting, setExporting] = useState(false);
  const [savingToProfile, setSavingToProfile] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);

  const [sectionPreset, setSectionPreset] = useState("standard");
  const [sectionRowsVersion, setSectionRowsVersion] = useState(0);

  // On stacked (mobile) layouts the settings panel starts collapsed so the
  // document — the thing you actually edit — is the first thing visible,
  // instead of the old pattern of hiding the document behind a button.
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [letterTone, setLetterTone] = useState("");
  const [letterJobTitle, setLetterJobTitle] = useState("");
  const [letterCompanyName, setLetterCompanyName] = useState("");

  const [textColor, setTextColor] = useState("#0f172a");
  const [highlightColor, setHighlightColor] = useState("#fff59d");
  const [activeFormats, setActiveFormats] = useState({});

  // The canvas is an uncontrolled contenteditable surface — its innerHTML is
  // the source of truth for document content and is only ever set
  // imperatively (initial seed, mode switch, tone regenerate). React never
  // re-renders its children, so typing never fights a re-render.
  const canvasRef = useRef(null);
  const resumeHtmlRef = useRef("");
  const letterHtmlRef = useRef("");
  const initializedRef = useRef(false);

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    [],
  );

  useEffect(() => {
    let mounted = true;
    // Applying mode asks the server first whether this job can be applied to (it exists, is
    // listed and open, and this applicant has not applied). A "no" is a message, not a studio.
    const checkJob = applying
      ? jobAPI
          .getApplyContext(targetJobId)
          .then((res) => ({ job: res.data?.job || null, code: "" }))
          .catch((error) => ({ job: null, code: error.response?.data?.code || (error.response?.status === 404 ? "JOB_NOT_FOUND" : "CHECK_FAILED") }))
      : Promise.resolve({ job: null, code: "" });
    Promise.all([authAPI.getProfile(), checkJob])
      .then(async ([{ data }, check]) => {
        if (!mounted) return;
        if (applying && !check.job) {
          setBlockedCode(check.code || "CHECK_FAILED");
          return;
        }
        // The job's match data (which of the applicant's skills it asks for) only ever tailors; a
        // failure just means a generic letter and an untouched skills order.
        const jobRes = applying ? await jobAPI.getJobById(targetJobId).catch(() => null) : null;
        if (!mounted) return;
        const loadedUser = data?.user || null;
        const loadedProfile = data?.profile || null;
        const loadedJob = jobRes?.data || null;
        setUser(loadedUser);
        setProfile(loadedProfile);
        setTargetJob(loadedJob);
        setApplyJob(check.job);
        setLetterAddressee(cleanHiringManagerName(check.job?.hiringManagerName));

        const sections = buildInitialResumeSections(loadedUser, loadedProfile);
        // Tailoring only reorders the applicant's OWN skills (the ones the job asks for first).
        const skillsSection = sections.find((s) => s.id === "skills");
        const matched = applying ? matchedSkillNames(loadedJob) : [];
        if (applying && skillsSection) {
          const reordered = reorderSkills(buildSkillsList(loadedUser, loadedProfile), matched);
          skillsSection.content = reordered.skills.join(", ");
        }
        // No hand-written "about" bio yet — seed a draft summary instead of
        // leaving the section blank. Marked as generated so it's still
        // fair game for the section presets to rewrite until the jobseeker
        // edits it themselves.
        const summarySection = sections.find((s) => s.id === "summary");
        if (summarySection && !summarySection.content.trim()) {
          summarySection.content = buildSummaryDraft("standard", loadedUser, loadedProfile);
          summarySection.visible = true;
          summarySection.generated = true;
        }

        const derivedName = fullNameOf(loadedUser);
        const derivedContact = [
          loadedUser?.email,
          formatPhoneDisplay(loadedUser?.phone),
          formatStructuredAddress(loadedProfile?.presentAddress) || loadedUser?.address,
        ]
          .filter(Boolean)
          .join("  ·  ");

        resumeHtmlRef.current = buildResumeHtml({
          name: derivedName,
          headline: applying ? tailoredHeadline(check.job?.title, loadedUser?.desiredJobTitle || "") : loadedUser?.desiredJobTitle || "",
          contactLine: derivedContact,
          sections,
          matchedSkills: matched,
        });

        // Applying mode pre-fills and generates the letter right away for THIS job: its exact title,
        // the employer's name, the hiring contact (or "Hiring Manager") and the location.
        const letterCompany = check.job?.companyName || "";
        const letterTitle = check.job?.title || "";
        const letterToneValue = applying ? "professional" : "";
        const letterAddressee0 = cleanHiringManagerName(check.job?.hiringManagerName);
        setLetterCompanyName(letterCompany);
        setLetterJobTitle(letterTitle);
        setLetterTone(letterToneValue);

        letterHtmlRef.current = buildLetterHtml({
          name: derivedName,
          contactLine: derivedContact,
          todayLabel,
          companyName: letterCompany,
          tone: letterToneValue,
          jobTitle: letterTitle,
          hiringManagerName: letterAddressee0,
          location: check.job?.location || "",
          extraReplacements: {
            ...buildProfileCoverLetterReplacements(loadedUser, loadedProfile),
            ...buildJobMatchedCoverLetterReplacements(loadedJob),
          },
        });
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time seed once the canvas node exists (it doesn't while `loading`
  // is still showing the placeholder screen below).
  useEffect(() => {
    if (loading || !canvasRef.current || initializedRef.current) return;
    canvasRef.current.innerHTML = mode === "resume" ? resumeHtmlRef.current : letterHtmlRef.current;
    initializedRef.current = true;
    setSectionRowsVersion((v) => v + 1);
  }, [loading, mode]);

  const name = useMemo(() => fullNameOf(user), [user]);
  const contactLine = useMemo(
    () =>
      [user?.email, formatPhoneDisplay(user?.phone), formatStructuredAddress(profile?.presentAddress) || user?.address]
        .filter(Boolean)
        .join("  ·  "),
    [user, profile],
  );

  /* ---------------------------------------------------------------
     Mode switch — capture the outgoing mode's edits, load the other's.
     --------------------------------------------------------------- */
  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    const canvas = canvasRef.current;
    if (canvas) {
      if (mode === "resume") resumeHtmlRef.current = canvas.innerHTML;
      else letterHtmlRef.current = canvas.innerHTML;
      canvas.innerHTML = nextMode === "resume" ? resumeHtmlRef.current : letterHtmlRef.current;
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    setSectionRowsVersion((v) => v + 1);
  };

  // Edits a document that may not be on screen: the live canvas when it is the current mode,
  // otherwise a detached copy of the saved HTML (written back afterwards).
  const withDocumentRoot = (kind, edit) => {
    if (modeRef.current === kind && canvasRef.current) {
      edit(canvasRef.current);
      return;
    }
    const ref = kind === "resume" ? resumeHtmlRef : letterHtmlRef;
    const holder = document.createElement("div");
    holder.innerHTML = ref.current;
    edit(holder);
    ref.current = holder.innerHTML;
  };

  // Reads a document that may not be on screen, without changing anything.
  const readDocumentRoot = (kind) => {
    if (modeRef.current === kind && canvasRef.current) return canvasRef.current;
    const holder = document.createElement("div");
    holder.innerHTML = kind === "resume" ? resumeHtmlRef.current : letterHtmlRef.current;
    return holder;
  };

  /* ---------------------------------------------------------------
     Sections & order — read from and act directly on the canvas DOM.
     --------------------------------------------------------------- */
  const sectionRows = useMemo(() => {
    if (mode !== "resume") return [];
    const canvas = canvasRef.current;
    if (!canvas) return [];
    const nodes = Array.from(canvas.querySelectorAll(".resume-doc__section[data-section]"));
    return nodes.map((el, index) => ({
      id: el.dataset.section,
      title: SECTION_TITLES[el.dataset.section] || el.dataset.section,
      visible: el.style.display !== "none",
      isFirst: index === 0,
      isLast: index === nodes.length - 1,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sectionRowsVersion]);

  // Every section action (show/hide, move, preset) changes the document, so it counts as an edit.
  const bumpSectionRows = () => {
    setSectionRowsVersion((v) => v + 1);
    markDirty();
  };

  const toggleSectionVisible = (sectionId) => {
    const el = canvasRef.current?.querySelector(`.resume-doc__section[data-section="${sectionId}"]`);
    if (!el) return;
    el.style.display = el.style.display === "none" ? "" : "none";
    setSectionPreset(null);
    bumpSectionRows();
  };

  const moveSection = (sectionId, direction) => {
    const el = canvasRef.current?.querySelector(`.resume-doc__section[data-section="${sectionId}"]`);
    if (!el) return;
    if (direction === -1 && el.previousElementSibling) {
      el.parentNode.insertBefore(el, el.previousElementSibling);
    } else if (direction === 1 && el.nextElementSibling) {
      el.parentNode.insertBefore(el.nextElementSibling, el);
    }
    setSectionPreset(null);
    bumpSectionRows();
  };

  const applyPreset = (presetKey) => {
    const preset = RESUME_SECTION_PRESETS.find((p) => p.key === presetKey);
    const main = canvasRef.current?.querySelector(".resume-doc__main");
    if (!preset || !main) return;
    preset.order.forEach((id) => {
      const el = main.querySelector(`.resume-doc__section[data-section="${id}"]`);
      if (el) {
        el.style.display = "";
        main.appendChild(el);
      }
    });

    // Re-phrase the Professional Summary for this persona — but only while
    // it's still the untouched draft. Once the jobseeker has hand-edited
    // it, presets stop overwriting their own words.
    const summaryEl = main.querySelector('.resume-doc__section[data-section="summary"]');
    if (summaryEl?.dataset.generated === "true") {
      setSectionDraftText(summaryEl, buildSummaryDraft(presetKey, user, profile));
    }

    setSectionPreset(presetKey);
    bumpSectionRows();
  };

  // Typing inside the auto-drafted summary "claims" it as the jobseeker's
  // own words, so a later preset click no longer rewrites it out from
  // under them.
  const handleCanvasInput = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const node = selection.getRangeAt(0).startContainer;
    const container = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const summaryEl = container?.closest?.('.resume-doc__section[data-section="summary"]');
    if (summaryEl && summaryEl.dataset.generated === "true") {
      delete summaryEl.dataset.generated;
    }
  };

  /* ---------------------------------------------------------------
     Cover letter — tone regenerates the body; company name live-patches
     just the recipient line so in-progress edits to the body are never
     silently overwritten by typing in the side panel.
     --------------------------------------------------------------- */
  const applyLetterTone = (tone) => {
    setLetterTone(tone);
    // Picking a tone is the one click that also auto-fills the letter with
    // the jobseeker's own skills/experience from their profile, instead of
    // leaving generic "[list your key skills]" bracket placeholders to be
    // filled in by hand.
    const extraReplacements = {
      ...buildProfileCoverLetterReplacements(user, profile),
      ...buildJobMatchedCoverLetterReplacements(targetJob),
    };
    const html = buildLetterHtml({
      name, contactLine, todayLabel, companyName: letterCompanyName, tone, jobTitle: letterJobTitle,
      hiringManagerName: letterAddressee, location: applyJob?.location || "", extraReplacements,
    });
    letterHtmlRef.current = html;
    if (mode === "coverLetter" && canvasRef.current) canvasRef.current.innerHTML = html;
    markDirty();
  };

  const clearLetter = () => {
    setLetterTone("");
    const html = buildLetterHtml({
      name, contactLine, todayLabel, companyName: letterCompanyName, tone: "", jobTitle: letterJobTitle,
      hiringManagerName: letterAddressee, location: applyJob?.location || "",
    });
    letterHtmlRef.current = html;
    if (mode === "coverLetter" && canvasRef.current) canvasRef.current.innerHTML = html;
    markDirty();
  };

  // "Addressed to": changes the name line and the salutation in place, leaving the body alone.
  const handleAddresseeChange = (e) => {
    const value = cleanHiringManagerName(e.target.value);
    setLetterAddressee(e.target.value.slice(0, 80));
    markDirty();
    withDocumentRoot("coverLetter", (root) => {
      const salutation = root.querySelector(".letter-doc__salutation");
      if (salutation) salutation.textContent = salutationFor(value);
      let line = root.querySelector(".letter-doc__addressee");
      if (value) {
        if (!line) {
          line = document.createElement("p");
          line.className = "letter-doc__addressee";
          root.querySelector(".letter-doc__date")?.insertAdjacentElement("afterend", line);
        }
        line.textContent = value;
      } else if (line) {
        line.remove();
      }
    });
  };

  const handleLetterCompanyChange = (e) => {
    const value = e.target.value;
    setLetterCompanyName(value);
    markDirty();
    if (mode !== "coverLetter" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let recipientEl = canvas.querySelector(".letter-doc__recipient");
    if (value.trim()) {
      if (!recipientEl) {
        recipientEl = document.createElement("p");
        recipientEl.className = "letter-doc__recipient";
        const dateEl = canvas.querySelector(".letter-doc__date");
        (dateEl || canvas.querySelector(".letter-doc__sender"))?.insertAdjacentElement("afterend", recipientEl);
      }
      recipientEl.textContent = value;
    } else if (recipientEl) {
      recipientEl.remove();
    }
  };

  /* ---------------------------------------------------------------
     Formatting toolbar
     --------------------------------------------------------------- */
  const syncToolbarState = () => {
    const next = {};
    TOOLBAR_STATE_COMMANDS.forEach((cmd) => {
      try {
        next[cmd] = document.queryCommandState(cmd);
      } catch {
        next[cmd] = false;
      }
    });
    setActiveFormats(next);
  };

  useEffect(() => {
    const handler = () => {
      if (document.activeElement === canvasRef.current) syncToolbarState();
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []);

  const runCmd = (cmd, value) => {
    canvasRef.current?.focus();
    document.execCommand(cmd, false, value ?? null);
    syncToolbarState();
  };

  const handleFontFamily = (e) => runCmd("fontName", e.target.value);
  const handleFontSize = (e) => runCmd("fontSize", FONT_SIZE_MAP[e.target.value] || "3");
  const handleTextColor = (e) => {
    setTextColor(e.target.value);
    runCmd("foreColor", e.target.value);
  };
  const handleHighlight = (e) => {
    const value = e.target.value;
    setHighlightColor(value);
    canvasRef.current?.focus();
    const ok = document.execCommand("hiliteColor", false, value);
    if (!ok) document.execCommand("backColor", false, value);
    syncToolbarState();
  };

  // The layout on the canvas: the ATS template for an ATS resume, else the chosen standard one
  // (cover letters always use a standard layout).
  const canvasTemplateKey = mode === "resume" && resumeType === "ats" ? ATS_TEMPLATE.key : templateKey;
  const photoUrl = useMemo(() => photoUrlOf(user, profile), [user, profile]);

  const documentLabel = (kind) => (kind === "resume" ? "resume" : "cover-letter");
  // Library name: a clear "Cover letter - <Job> - <Employer>" when applying, else the file name.
  const titleFor = (kind) =>
    applying && applyJob
      ? documentTitle(kind === "resume" ? "Resume" : "Cover letter", applyJob.title, applyJob.companyName)
      : `${name.replace(/\s+/g, "-")}-${documentLabel(kind)}.pdf`;

  /* ---------------------------------------------------------------
     Documents on screen and in the PDF.
     --------------------------------------------------------------- */
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Puts `kind` on the canvas (switching if it is the other one) and waits for it to be laid out.
  const showDocument = async (kind) => {
    if (modeRef.current !== kind) {
      switchMode(kind);
      await nextPaint();
    }
    return canvasRef.current;
  };

  // An ATS resume is written as real text (utils/atsPdf.js); everything else is drawn as a picture.
  const renderBlob = (kind, node) => (kind === "resume" && resumeType === "ats" ? renderAtsPdfBlob(node) : renderHtmlNodeToPdfBlob({ node }));

  // The letter's own words, without the sender / date / address / salutation / sign-off lines.
  const letterBodyText = () => {
    const clone = readDocumentRoot("coverLetter").cloneNode(true);
    clone
      .querySelectorAll(".letter-doc__sender, .letter-doc__date, .letter-doc__addressee, .letter-doc__recipient, .letter-doc__location, .letter-doc__salutation, .letter-doc__signoff")
      .forEach((el) => el.remove());
    clone.querySelectorAll(".letter-doc__paragraph--empty").forEach((el) => {
      if (/^Pick a writing tone/.test(el.textContent.trim())) el.remove();
    });
    return clone.textContent.trim();
  };

  const resumeHasContent = () =>
    Array.from(readDocumentRoot("resume").querySelectorAll(".resume-doc__section")).some(
      (section) => section.style.display !== "none" && section.textContent.replace(section.querySelector("h3")?.textContent || "", "").trim(),
    );

  // What is missing before the documents can be saved for an application ([] when all is well).
  const letterIssue = () => {
    const body = letterBodyText();
    if (!body) return "missingLetterEmpty";
    return hasPlaceholder(readDocumentRoot("coverLetter").textContent) ? "missingLetterPlaceholder" : "";
  };
  const showIssues = (issues) =>
    setBlockMessage(issues.length ? `${t("applyFlow.missingLead")} ${issues.map((key) => t(`applyFlow.${key}`)).join("; ")}.` : "");
  const collectIssues = () => {
    const issues = [];
    if (!uploadedResume && !resumeHasContent()) issues.push("missingResume");
    const letter = letterIssue();
    if (letter) issues.push(letter);
    return issues;
  };

  /* ---------------------------------------------------------------
     Resume type, photo, upload.
     --------------------------------------------------------------- */
  const stripPhoto = (root) => root.querySelectorAll(".resume-doc__photo").forEach((el) => el.remove());

  const chooseResumeType = (next) => {
    if (next === resumeType) return;
    setResumeType(next);
    if (next === "ats") {
      // Hiring software cannot read a photo: it is removed and the toggle is locked off.
      setShowPhoto(false);
      setPhotoState("");
      withDocumentRoot("resume", stripPhoto);
    }
    markDirty("resume");
  };

  const handlePhotoToggle = async (checked) => {
    if (resumeType === "ats") return;
    if (!checked) {
      setShowPhoto(false);
      setPhotoState("");
      withDocumentRoot("resume", stripPhoto);
      markDirty("resume");
      return;
    }
    setPhotoState("loading");
    const dataUrl = photoDataRef.current || (await fetchPhotoDataUrl(photoUrl));
    if (!dataUrl) {
      setPhotoState("failed");
      setShowPhoto(false);
      return;
    }
    photoDataRef.current = dataUrl;
    setPhotoState("");
    setShowPhoto(true);
    withDocumentRoot("resume", (root) => {
      stripPhoto(root);
      root.querySelector(".resume-doc__header")?.insertAdjacentHTML("afterbegin", photoHtml(dataUrl));
    });
    markDirty("resume");
  };

  const handleResumeFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError("");
    if (!/\.(pdf|docx?)$/i.test(file.name)) {
      setUploadError(t("applyFlow.uploadBadType"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t("applyFlow.uploadTooBig"));
      return;
    }
    setUploading(true);
    try {
      const { data } = await jobseekerDocumentAPI.upload({ file, kind: "resume", title: file.name, source: "upload" });
      setUploadedResume({ id: String(data._id), title: data.title || file.name });
      setStatusMessage(t("applyFlow.uploadDone"));
    } catch (error) {
      setUploadError(error.response?.data?.message || t("applyFlow.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  /* ---------------------------------------------------------------
     Export / save — act on the documents as the applicant left them.
     --------------------------------------------------------------- */
  const handleExportPdf = async () => {
    const node = canvasRef.current;
    if (!node) return;
    try {
      setExporting(true);
      const filename = `${name.replace(/\s+/g, "-")}-${documentLabel(mode)}.pdf`;
      if (mode === "resume" && resumeType === "ats") downloadBlob(filename, renderAtsPdfBlob(node));
      else await exportHtmlNodeToPdf({ node, filename });
    } catch (error) {
      console.error("Failed to export PDF", error);
      toast.error("Failed to export PDF.");
    } finally {
      setExporting(false);
    }
  };

  const handleSaveToProfile = async () => {
    if (mode !== "resume" || !canvasRef.current) return;
    try {
      setSavingToProfile(true);
      const filename = `${name.replace(/\s+/g, "-")}-resume.pdf`;
      const blob = await renderBlob("resume", canvasRef.current);
      await authAPI.uploadGeneratedResume(blob, filename);

      // "Save to Profile" sets the single official resume (used for NSRP Form 1),
      // which lives on the user document, not in the Resumes & Cover Letters
      // library. Jobseekers reasonably expect a resume they just saved to show
      // up wherever their resumes are listed, so mirror it into the library too.
      try {
        const file = new File([blob], filename, { type: "application/pdf" });
        await jobseekerDocumentAPI.upload({ file, kind: "resume", title: filename, source: "builder", resumeType });
      } catch (libraryError) {
        // The profile save already succeeded — don't let a library-mirror
        // failure surface as if the whole action failed.
        console.warn("Failed to mirror resume into the document library", libraryError);
      }

      setStatusMessage(t("applyFlow.savedLibrary"));
      toast.success("Saved to your profile.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save resume to profile.");
    } finally {
      setSavingToProfile(false);
    }
  };

  // Saves one document to the library and returns the saved row. Saving the same content again
  // (a second press, or Continue after Save) reuses the row instead of adding a duplicate.
  const saveDocument = async (kind) => {
    const node = await showDocument(kind);
    if (!node) throw new Error("The document is not on screen.");
    const signature = `${kind === "resume" ? resumeType : ""}|${node.innerHTML}`;
    const known = savedDocsRef.current[kind];
    if (known && known.signature === signature) return known.doc;
    const title = titleFor(kind);
    const blob = await renderBlob(kind, node);
    const file = new File([blob], documentFileName(title), { type: "application/pdf" });
    const { data } = await jobseekerDocumentAPI.upload({
      file,
      kind,
      title,
      source: "builder",
      // Marks a cover letter as made for THIS job; the server only accepts such a letter for it.
      sourceJobId: kind === "coverLetter" && applying ? targetJobId : undefined,
      resumeType: kind === "resume" ? resumeType : undefined,
    });
    savedDocsRef.current[kind] = { signature, doc: data };
    return data;
  };

  const handleSaveToLibrary = async () => {
    if (!canvasRef.current) return;
    if (mode === "coverLetter") {
      const issue = letterIssue();
      if (issue) {
        showIssues([issue]);
        return;
      }
    }
    setBlockMessage("");
    try {
      setSavingToLibrary(true);
      await saveDocument(mode);
      clearDirty(mode);
      setStatusMessage(t("applyFlow.savedLibrary"));
      toast.success(t("applyFlow.savedLibrary"));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save to your library.");
    } finally {
      setSavingToLibrary(false);
    }
  };

  /* ---------------------------------------------------------------
     Applying mode: Back, and Continue to submit application.
     --------------------------------------------------------------- */
  const requestBack = () => {
    if (dirty) setLeaveOpen(true);
    else navigate(backPath);
  };

  // Saves the resume and the cover letter, then returns to the board with the Apply modal open for
  // this job and the new documents picked. Nothing is submitted: the applicant presses Submit there.
  const handleContinue = async () => {
    if (continuing || !applyJob) return;
    const issues = collectIssues();
    if (issues.length) {
      showIssues(issues);
      return;
    }
    setBlockMessage("");
    setContinuing(true);
    try {
      const resumeId = uploadedResume ? uploadedResume.id : String((await saveDocument("resume"))._id);
      const letter = await saveDocument("coverLetter");
      clearDirty();
      toast.success(t("applyFlow.saved"));
      navigate(backPath, { state: { reopenApply: { jobId: targetJobId, resumeId, coverLetterId: String(letter._id) } } });
    } catch (error) {
      setBlockMessage(error.response?.data?.message || t("applyFlow.saveFailed"));
    } finally {
      setContinuing(false);
    }
  };

  const leaveAndSave = async () => {
    setLeaveOpen(false);
    await handleContinue();
  };

  if (loading) {
    return (
      <div className="rstudio-page">
        <div className="rstudio-loading">Loading your profile…</div>
      </div>
    );
  }

  // Applying mode, but this job cannot be applied to (gone, closed, unlisted or already applied):
  // say so plainly and offer the way back. No studio, so nothing can be saved for it.
  if (applying && blockedCode) {
    const messageKey = { JOB_NOT_FOUND: "jobNotFound", JOB_CLOSED: "jobClosed", ALREADY_APPLIED: "alreadyApplied" }[blockedCode] || "jobCheckFailed";
    return (
      <div className="rstudio-page">
        <div className="rstudio-blocked">
          <p role="alert">{t(`applyFlow.${messageKey}`)}</p>
          <Link className="rstudio-btn rstudio-btn--primary" to={backPath}>
            {t("applyFlow.backToJobs")}
          </Link>
        </div>
      </div>
    );
  }

  const applyEmployer = applyJob?.companyName || "";
  const blockId = "rstudio-block-message";

  return (
    <div className="rstudio-page">
      {applying && applyJob ? (
        <div className="rstudio-applybar">
          <div className="rstudio-applybar__banner">
            {applyEmployer
              ? t("applyFlow.banner", { job: applyJob.title, employer: applyEmployer })
              : t("applyFlow.bannerNoEmployer", { job: applyJob.title })}
            {dirty ? <span className="rstudio-applybar__dirty"> · {t("applyFlow.unsavedChanges")}</span> : null}
          </div>
          <div className="rstudio-applybar__actions">
            <button type="button" className="rstudio-btn rstudio-btn--ghost" onClick={requestBack}>
              <FaArrowLeft aria-hidden="true" /> {t("applyFlow.back")}
            </button>
            <button
              type="button"
              className="rstudio-btn rstudio-btn--primary"
              onClick={handleContinue}
              aria-disabled={continuing}
              aria-describedby={blockMessage ? blockId : undefined}
              title={t("applyFlow.continueHelp")}
            >
              {continuing ? t("applyFlow.continueSaving") : t("applyFlow.continue")}
            </button>
          </div>
          {blockMessage ? (
            <p className="rstudio-applybar__error" id={blockId} role="alert">
              {blockMessage}
            </p>
          ) : null}
        </div>
      ) : blockMessage ? (
        <p className="rstudio-inline-error" id={blockId} role="alert">
          {blockMessage}
        </p>
      ) : null}
      <p className="rstudio-sr-status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <div className="rstudio-topbar">
        <div className="rstudio-heading">
          <nav className="rstudio-breadcrumb">
            <Link to="/profile">Profile</Link>
            <span className="rstudio-breadcrumb__sep">/</span>
            <span className="is-current">Resume &amp; Cover Letter Studio</span>
          </nav>
          <h1>NSRP Auto-Derived Career Studio</h1>
        </div>

        <div className="rstudio-topbar__actions">
          <div className="rstudio-modeswitch" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "resume"} className={mode === "resume" ? "is-active" : ""} onClick={() => switchMode("resume")}>
              <FaFileAlt /> Resume Builder
            </button>
            <button type="button" role="tab" aria-selected={mode === "coverLetter"} className={mode === "coverLetter" ? "is-active" : ""} onClick={() => switchMode("coverLetter")}>
              <FaEnvelopeOpenText /> Cover Letter Generator
            </button>
          </div>

          <button
            type="button"
            className="rstudio-btn rstudio-btn--ghost"
            onClick={handleSaveToProfile}
            disabled={mode !== "resume" || savingToProfile}
            title={mode !== "resume" ? "Saving cover letters to your profile isn't available yet" : undefined}
          >
            <FaSave /> {savingToProfile ? "Saving…" : "Save to Profile"}
          </button>
          <button
            type="button"
            className="rstudio-btn rstudio-btn--ghost"
            onClick={handleSaveToLibrary}
            disabled={savingToLibrary}
            aria-describedby={blockMessage ? blockId : undefined}
            title="Save this document to your Resumes & Cover Letters library so you can attach it to job applications"
          >
            <FaFolderPlus /> {savingToLibrary ? "Saving…" : "Save to Library"}
          </button>
          <button type="button" className="rstudio-btn rstudio-btn--primary" onClick={handleExportPdf} disabled={exporting}>
            <FaDownload /> {exporting ? "Preparing…" : "Export Printable PDF"}
          </button>
        </div>
      </div>

      <div className="rstudio-body">
        <button
          type="button"
          className="rstudio-mobile-panel-toggle"
          onClick={() => setMobilePanelOpen((v) => !v)}
          aria-expanded={mobilePanelOpen}
        >
          <span>{mode === "resume" ? "Resume settings" : "Cover letter settings"}</span>
          <span className="rstudio-mobile-panel-toggle__chevron" aria-hidden="true">{mobilePanelOpen ? "▲" : "▼"}</span>
        </button>

        <aside className={`rstudio-panel ${mobilePanelOpen ? "is-open" : ""}`}>
          <section className="rstudio-section rstudio-panel__pinned">
            {mode === "resume" ? (
              <div className="rstudio-type">
                <h4 id="rstudio-type-label">{t("applyFlow.resumeType")}</h4>
                <div className="rstudio-type__group" role="radiogroup" aria-labelledby="rstudio-type-label">
                  {[
                    { key: "standard", label: t("applyFlow.typeStandard") },
                    { key: "ats", label: t("applyFlow.typeAts") },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      role="radio"
                      aria-checked={resumeType === option.key}
                      className={`rstudio-type__option ${resumeType === option.key ? "is-selected" : ""}`}
                      onClick={() => chooseResumeType(option.key)}
                    >
                      {resumeType === option.key ? <FaCheck aria-hidden="true" /> : null} {option.label}
                    </button>
                  ))}
                </div>
                <p className="rstudio-muted rstudio-type__hint">
                  {resumeType === "ats" ? t("applyFlow.typeAtsHint") : t("applyFlow.typeStandardHint")}
                </p>
              </div>
            ) : null}
            <h4>Visual Style Template</h4>
            <div className="rstudio-template-grid">
              {(mode === "resume" && resumeType === "ats" ? [ATS_TEMPLATE] : DOCUMENT_TEMPLATES).map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  className={`rstudio-template-card ${canvasTemplateKey === tpl.key ? "is-selected" : ""}`}
                  onClick={() => {
                    if (tpl.key !== ATS_TEMPLATE.key) {
                      setTemplateKey(tpl.key);
                      markDirty();
                    }
                  }}
                  title={tpl.description}
                >
                  <span className={`tpl-thumb tpl-thumb--${tpl.key}`}>
                    <span className="tpl-thumb__accent" />
                    <span className="tpl-thumb__lines">
                      <span className="tpl-thumb__line" />
                      <span className="tpl-thumb__line tpl-thumb__line--short" />
                      <span className="tpl-thumb__line" />
                    </span>
                  </span>
                  <span className="rstudio-template-card__label">{tpl.label}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="rstudio-panel__scroll">
            {mode === "resume" ? (
              <>
              {applying ? <p className="rstudio-tailored-note">{t("applyFlow.tailoredNote")}</p> : null}
              <section className="rstudio-section">
                <h4>{t("applyFlow.photoToggle")}</h4>
                <label className="rstudio-checkbox">
                  <input
                    type="checkbox"
                    checked={showPhoto && resumeType !== "ats"}
                    disabled={resumeType === "ats" || !photoUrl || photoState === "loading"}
                    onChange={(e) => handlePhotoToggle(e.target.checked)}
                    aria-describedby="rstudio-photo-note"
                  />
                  <span className="rstudio-checkbox__label">{t("applyFlow.photoToggle")}</span>
                </label>
                <p className="rstudio-muted" id="rstudio-photo-note">
                  {resumeType === "ats" ? (
                    t("applyFlow.photoAtsOff")
                  ) : !photoUrl ? (
                    <>
                      {t("applyFlow.photoMissing")} <Link to="/profile">{t("applyFlow.photoAdd")}</Link>
                    </>
                  ) : photoState === "failed" ? (
                    t("applyFlow.photoLoadFailed")
                  ) : null}
                </p>
              </section>

              <section className="rstudio-section">
                <h4>{t("applyFlow.uploadResume")}</h4>
                <label className="rstudio-btn rstudio-btn--ghost rstudio-upload">
                  <FaUpload aria-hidden="true" /> {uploading ? t("applyFlow.uploading") : t("applyFlow.uploadResume")}
                  <input type="file" accept=".pdf,.doc,.docx" hidden onChange={handleResumeFile} disabled={uploading} aria-describedby="rstudio-upload-note" />
                </label>
                <p className="rstudio-muted" id="rstudio-upload-note">{t("applyFlow.uploadHint")}</p>
                {uploadError ? <p className="rstudio-inline-error" role="alert">{uploadError}</p> : null}
                {applying && uploadedResume ? (
                  <p className="rstudio-muted">
                    {uploadedResume.title}{" "}
                    <button type="button" className="rstudio-clear-link" onClick={() => setUploadedResume(null)} aria-label="Remove">×</button>
                  </p>
                ) : null}
              </section>

              <section className="rstudio-section">
                <div className="rstudio-section__headrow">
                  <h4>Sections &amp; Order</h4>
                  <span className="rstudio-muted">Click into the document to edit</span>
                </div>
                <div className="rstudio-preset-list">
                  {RESUME_SECTION_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className={`rstudio-preset-btn ${sectionPreset === preset.key ? "is-active" : ""}`}
                      onClick={() => applyPreset(preset.key)}
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="rstudio-sections-list">
                  {sectionRows.map((row) => (
                    <div className="rstudio-section-row" key={row.id}>
                      <label className="rstudio-checkbox">
                        <input type="checkbox" checked={row.visible} onChange={() => toggleSectionVisible(row.id)} />
                        <span className="rstudio-checkbox__label">{row.title}</span>
                      </label>
                      <div className="rstudio-section-row__move">
                        <button type="button" onClick={() => moveSection(row.id, -1)} disabled={row.isFirst} aria-label={`Move ${row.title} up`}>
                          <span aria-hidden="true">▲</span>
                        </button>
                        <button type="button" onClick={() => moveSection(row.id, 1)} disabled={row.isLast} aria-label={`Move ${row.title} down`}>
                          <span aria-hidden="true">▼</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              </>
            ) : (
              <>
                <section className="rstudio-section">
                  <h4>Writing Tone</h4>
                  <div className="rstudio-tone-list">
                    {LETTER_TONES.map((tone) => (
                      <label key={tone.key} className={`rstudio-tone-card ${letterTone === tone.key ? "is-selected" : ""}`}>
                        <input type="radio" name="letter-tone" checked={letterTone === tone.key} onChange={() => applyLetterTone(tone.key)} />
                        <span className="rstudio-tone-card__body">
                          <strong>{tone.label}</strong>
                          <small>{tone.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button type="button" className="rstudio-clear-link" onClick={clearLetter}>Clear cover letter content</button>
                </section>

                <section className="rstudio-section">
                  <h4>Target Application</h4>
                  <label className="rstudio-field">
                    <span>Target Employer / Company</span>
                    <input type="text" value={letterCompanyName} onChange={handleLetterCompanyChange} placeholder="e.g. Marinduque Trading Corp." />
                  </label>
                  <label className="rstudio-field">
                    <span>Target Job Position</span>
                    <input type="text" value={letterJobTitle} onChange={(e) => { setLetterJobTitle(e.target.value); markDirty(); }} placeholder="e.g. Administrative Assistant" />
                  </label>
                  <label className="rstudio-field">
                    <span>{t("applyFlow.addressedTo")}</span>
                    <input type="text" value={letterAddressee} onChange={handleAddresseeChange} maxLength={80} placeholder={t("applyFlow.hiringManagerPlaceholder")} aria-describedby="rstudio-addressee-help" />
                  </label>
                  <p className="rstudio-muted" id="rstudio-addressee-help">{t("applyFlow.addressedToHelp")}</p>
                </section>
              </>
            )}
          </div>
        </aside>

        <div className="rstudio-doc-workspace">
          <div className="rstudio-toolbar" role="toolbar" aria-label="Formatting">
            <div className="rstudio-tb-group" onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className="rstudio-tb-btn" onClick={() => runCmd("undo")} title="Undo"><FaUndo /></button>
              <button type="button" className="rstudio-tb-btn" onClick={() => runCmd("redo")} title="Redo"><FaRedo /></button>
            </div>
            <span className="rstudio-tb-divider" />
            <div className="rstudio-tb-group">
              <select className="rstudio-tb-select rstudio-tb-select--font" onChange={handleFontFamily} defaultValue={FONT_FAMILIES[0].value} title="Font family">
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select className="rstudio-tb-select rstudio-tb-select--size" onChange={handleFontSize} defaultValue="11" title="Font size">
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
            <span className="rstudio-tb-divider" />
            <div className="rstudio-tb-group" onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.bold ? "is-active" : ""}`} onClick={() => runCmd("bold")} title="Bold"><FaBold /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.italic ? "is-active" : ""}`} onClick={() => runCmd("italic")} title="Italic"><FaItalic /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.underline ? "is-active" : ""}`} onClick={() => runCmd("underline")} title="Underline"><FaUnderline /></button>
            </div>
            <span className="rstudio-tb-divider" />
            <div className="rstudio-tb-group">
              <button type="button" className="rstudio-tb-btn rstudio-tb-swatch" title="Text color">
                <FaPalette />
                <span className="rstudio-tb-swatch__bar" style={{ background: textColor }} />
                <input type="color" className="rstudio-tb-colorinput" value={textColor} onChange={handleTextColor} tabIndex={-1} aria-label="Text color" />
              </button>
              <button type="button" className="rstudio-tb-btn rstudio-tb-swatch" title="Highlight color">
                <FaHighlighter />
                <span className="rstudio-tb-swatch__bar" style={{ background: highlightColor }} />
                <input type="color" className="rstudio-tb-colorinput" value={highlightColor} onChange={handleHighlight} tabIndex={-1} aria-label="Highlight color" />
              </button>
            </div>
            <span className="rstudio-tb-divider" />
            <div className="rstudio-tb-group" onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.justifyLeft ? "is-active" : ""}`} onClick={() => runCmd("justifyLeft")} title="Align left"><FaAlignLeft /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.justifyCenter ? "is-active" : ""}`} onClick={() => runCmd("justifyCenter")} title="Align center"><FaAlignCenter /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.justifyRight ? "is-active" : ""}`} onClick={() => runCmd("justifyRight")} title="Align right"><FaAlignRight /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.justifyFull ? "is-active" : ""}`} onClick={() => runCmd("justifyFull")} title="Justify"><FaAlignJustify /></button>
            </div>
            <span className="rstudio-tb-divider" />
            <div className="rstudio-tb-group" onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.insertUnorderedList ? "is-active" : ""}`} onClick={() => runCmd("insertUnorderedList")} title="Bulleted list"><FaListUl /></button>
              <button type="button" className={`rstudio-tb-btn ${activeFormats.insertOrderedList ? "is-active" : ""}`} onClick={() => runCmd("insertOrderedList")} title="Numbered list"><FaListOl /></button>
            </div>
          </div>

          <div className="rstudio-canvas-scroll">
            <div
              ref={canvasRef}
              className={`rstudio-canvas ${mode === "resume" ? "resume-doc" : "letter-doc"} ${getTemplateClassName(canvasTemplateKey)}`}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              aria-label={mode === "resume" ? "Resume" : "Cover letter"}
              onInput={() => {
                if (mode === "resume") handleCanvasInput();
                markDirty();
                // Once a problem was shown, keep it current as the applicant fixes the text.
                if (blockMessage && applying) showIssues(collectIssues());
              }}
            />
          </div>
        </div>
      </div>

      <AppModal
        isOpen={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={t("applyFlow.leaveTitle")}
        titleId="rstudio-leave-title"
        describedBy="rstudio-leave-body"
        hideClose
      >
        <p id="rstudio-leave-body">{t("applyFlow.leaveBody")}</p>
        <div className="rstudio-leave__actions">
          <button type="button" className="rstudio-btn rstudio-btn--primary" onClick={leaveAndSave}>
            {t("applyFlow.leaveSave")}
          </button>
          <button type="button" className="rstudio-btn rstudio-btn--ghost" onClick={() => navigate(backPath)}>
            {t("applyFlow.leaveDiscard")}
          </button>
          <button type="button" className="rstudio-btn rstudio-btn--ghost" onClick={() => setLeaveOpen(false)}>
            {t("applyFlow.leaveStay")}
          </button>
        </div>
      </AppModal>
    </div>
  );
}
