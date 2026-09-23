import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
} from "react-icons/fa";
import { authAPI, jobseekerDocumentAPI } from "../services/api";
import { useToast } from "../components/feedback/context";
import { exportHtmlNodeToPdf, renderHtmlNodeToPdfBlob } from "../utils/exportUtils";
import {
  buildInitialResumeSections,
  buildSummaryDraft,
  formatStructuredAddress,
  fullNameOf,
  RESUME_SECTION_PRESETS,
} from "../utils/resumeDerivation";
import { applyTemplate as applyLetterTextTemplate, combineSections } from "../utils/coverLetterTemplates";
import { DOCUMENT_TEMPLATES, DEFAULT_TEMPLATE_KEY, getTemplateClassName } from "../data/resumeTemplates";
import "../styles/resume-studio.css";

const LETTER_TONES = [
  { key: "professional", label: "Professional & Formal", description: "Standard government/corporate tone" },
  { key: "enthusiastic", label: "Enthusiastic & Passionate", description: "Highlights drive and community commitment" },
  { key: "concise", label: "Concise & Direct", description: "Brief, high-impact bullet style" },
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

const buildResumeHtml = ({ name, headline, contactLine, sections }) => {
  const header =
    `<div class="resume-doc__header">` +
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
        textBlockToHtml(section.content) +
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

const buildLetterHtml = ({ name, contactLine, todayLabel, companyName, tone, jobTitle }) => {
  const applied = tone
    ? applyLetterTextTemplate(tone, { "{position}": jobTitle || "this position", "{company}": companyName || "your company" })
    : null;
  const combined = applied ? combineSections(applied) : "";
  const paragraphs = combined
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    `<div class="letter-doc__sender"><strong>${escapeHtml(name)}</strong>` +
    (contactLine ? `<span>${escapeHtml(contactLine)}</span>` : "") +
    `</div>` +
    `<p class="letter-doc__date">${escapeHtml(todayLabel)}</p>` +
    (companyName ? `<p class="letter-doc__recipient">${escapeHtml(companyName)}</p>` : "") +
    `<p class="letter-doc__salutation">Dear Hiring Manager,</p>` +
    (paragraphs.length
      ? paragraphs.map((p) => `<p class="letter-doc__paragraph">${escapeHtml(p)}</p>`).join("")
      : `<p class="letter-doc__paragraph letter-doc__paragraph--empty">Pick a writing tone on the left, or start typing your letter here.</p>`) +
    `<p class="letter-doc__signoff">Sincerely,<br>${escapeHtml(name)}</p>`
  );
};

export default function ResumeStudio() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [mode, setMode] = useState(() => (searchParams.get("mode") === "coverLetter" ? "coverLetter" : "resume"));
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY);
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
    authAPI
      .getProfile()
      .then(({ data }) => {
        if (!mounted) return;
        const loadedUser = data?.user || null;
        const loadedProfile = data?.profile || null;
        setUser(loadedUser);
        setProfile(loadedProfile);

        const sections = buildInitialResumeSections(loadedUser, loadedProfile);
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
          loadedUser?.phone,
          formatStructuredAddress(loadedProfile?.presentAddress) || loadedUser?.address,
        ]
          .filter(Boolean)
          .join("  ·  ");

        resumeHtmlRef.current = buildResumeHtml({
          name: derivedName,
          headline: loadedUser?.desiredJobTitle || "",
          contactLine: derivedContact,
          sections,
        });
        letterHtmlRef.current = buildLetterHtml({
          name: derivedName,
          contactLine: derivedContact,
          todayLabel,
          companyName: "",
          tone: "",
          jobTitle: "",
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
      [user?.email, user?.phone, formatStructuredAddress(profile?.presentAddress) || user?.address]
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
    setMode(nextMode);
    setSectionRowsVersion((v) => v + 1);
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

  const bumpSectionRows = () => setSectionRowsVersion((v) => v + 1);

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
    const html = buildLetterHtml({ name, contactLine, todayLabel, companyName: letterCompanyName, tone, jobTitle: letterJobTitle });
    letterHtmlRef.current = html;
    if (mode === "coverLetter" && canvasRef.current) canvasRef.current.innerHTML = html;
  };

  const clearLetter = () => {
    setLetterTone("");
    const html = buildLetterHtml({ name, contactLine, todayLabel, companyName: letterCompanyName, tone: "", jobTitle: letterJobTitle });
    letterHtmlRef.current = html;
    if (mode === "coverLetter" && canvasRef.current) canvasRef.current.innerHTML = html;
  };

  const handleLetterCompanyChange = (e) => {
    const value = e.target.value;
    setLetterCompanyName(value);
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

  /* ---------------------------------------------------------------
     Export / save — always act on whatever the canvas currently shows.
     --------------------------------------------------------------- */
  const handleExportPdf = async () => {
    const node = canvasRef.current;
    if (!node) return;
    try {
      setExporting(true);
      const suffix = mode === "resume" ? "resume" : "cover-letter";
      await exportHtmlNodeToPdf({ node, filename: `${name.replace(/\s+/g, "-")}-${suffix}.pdf` });
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
      const blob = await renderHtmlNodeToPdfBlob({ node: canvasRef.current });
      await authAPI.uploadGeneratedResume(blob, filename);

      // "Save to Profile" sets the single official resume (used for NSRP Form 1),
      // which lives on the user document, not in the Resumes & Cover Letters
      // library. Jobseekers reasonably expect a resume they just saved to show
      // up wherever their resumes are listed, so mirror it into the library too.
      try {
        const file = new File([blob], filename, { type: "application/pdf" });
        await jobseekerDocumentAPI.upload({ file, kind: "resume", title: filename, source: "builder" });
      } catch (libraryError) {
        // The profile save already succeeded — don't let a library-mirror
        // failure surface as if the whole action failed.
        console.warn("Failed to mirror resume into the document library", libraryError);
      }

      toast.success("Saved to your profile.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save resume to profile.");
    } finally {
      setSavingToProfile(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!canvasRef.current) return;
    try {
      setSavingToLibrary(true);
      const suffix = mode === "resume" ? "resume" : "cover-letter";
      const filename = `${name.replace(/\s+/g, "-")}-${suffix}.pdf`;
      const blob = await renderHtmlNodeToPdfBlob({ node: canvasRef.current });
      const file = new File([blob], filename, { type: "application/pdf" });
      await jobseekerDocumentAPI.upload({
        file,
        kind: mode === "resume" ? "resume" : "coverLetter",
        title: filename,
        source: "builder",
      });
      toast.success("Saved to your document library.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save to your library.");
    } finally {
      setSavingToLibrary(false);
    }
  };

  if (loading) {
    return (
      <div className="rstudio-page">
        <div className="rstudio-loading">Loading your profile…</div>
      </div>
    );
  }

  return (
    <div className="rstudio-page">
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
            <h4>Visual Style Template</h4>
            <div className="rstudio-template-grid">
              {DOCUMENT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  className={`rstudio-template-card ${templateKey === tpl.key ? "is-selected" : ""}`}
                  onClick={() => setTemplateKey(tpl.key)}
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
                    <input type="text" value={letterJobTitle} onChange={(e) => setLetterJobTitle(e.target.value)} placeholder="e.g. Administrative Assistant" />
                  </label>
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
              className={`rstudio-canvas ${mode === "resume" ? "resume-doc" : "letter-doc"} ${getTemplateClassName(templateKey)}`}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              onInput={mode === "resume" ? handleCanvasInput : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
