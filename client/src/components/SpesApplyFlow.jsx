import { Fragment, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, FileText, Info, TriangleAlert } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import { spesAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import { requiredSlotsFor } from "../utils/spesSlots";
import { SPES_DOC_LIMITS, bytesToMb, formatFileSize, uploadErrorCode } from "../utils/spesUploadLimits";
import { useConfirm, useToast } from "./feedback/context";
import AppModal from "./AppModal";
import Autosuggest from "./Autosuggest";
import FileUpload from "./FileUpload";
import "../styles/spes-apply.css";
import marinduqueSchoolsData from "../data/marinduque_schools.json";

// Secondary schools map to the high school grade options; higher-ed and
// tech-voc schools (both organized into "years") map to the college options.
// Elementary schools are excluded: SPES applicants are high school,
// college/TVET students, or out-of-school youth.
const SCHOOL_LEVEL_BY_NAME = new Map();
(marinduqueSchoolsData.secondary_schools || []).forEach((school) => {
  if (school.name) SCHOOL_LEVEL_BY_NAME.set(school.name, "highschool");
});
[
  ...(marinduqueSchoolsData.universities_colleges || []),
  ...(marinduqueSchoolsData.technical_vocational_schools || []),
].forEach((school) => {
  if (school.name) SCHOOL_LEVEL_BY_NAME.set(school.name, "college");
});

const MARINDUQUE_SCHOOL_OPTIONS = Array.from(SCHOOL_LEVEL_BY_NAME.keys()).sort((a, b) => a.localeCompare(b));

const HIGHSCHOOL_GRADE_OPTIONS = ["Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const COLLEGE_YEAR_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

const GWA_SCALES = {
  percent: { min: 0, max: 100, step: "0.01" },
  one_to_five: { min: 1, max: 5, step: "0.01" },
};

const EMPTY_FORM = {
  applicantType: "student",
  contactNumber: "",
  school: "",
  gradeLevel: "",
  gwa: "",
  gwaScale: "percent",
  guardianName: "",
  guardianContact: "",
};

const STEPS = ["info", "docs", "review"];

// Visual required marker; the control itself carries aria-required.
const Req = () => (
  <span className="spes-req" aria-hidden="true">
    {" "}
    *
  </span>
);

// The 3-step apply dialog (your details, typed documents, review and submit) for one
// SPES posting. The server re-checks everything; `guardianRequired` comes from the
// posting's eligibility response (it is true only for applicants under 18).
export default function SpesApplyFlow({ isOpen, onClose, posting, guardianRequired, onApplied }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const confirm = useConfirm();

  const [step, setStep] = useState("info");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, contactNumber: user?.phone || "" }));
  const [files, setFiles] = useState({});
  const [slotErrors, setSlotErrors] = useState({});
  const [fieldError, setFieldError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const abortRef = useRef(null);
  const submittingRef = useRef(false);
  const confirmingRef = useRef(false);

  // A request still in flight when the dialog unmounts is cancelled, not left running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const isOsy = form.applicantType === "osy";
  const slots = requiredSlotsFor(posting, form.applicantType);
  const addedCount = slots.filter((slot) => files[slot]).length;
  const docsComplete = addedCount === slots.length;
  const schoolLevel = SCHOOL_LEVEL_BY_NAME.get(form.school.trim());

  const updateField = (name, value) => {
    setFieldError("");
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSchoolChange = (value) => {
    setForm((prev) => {
      const prevLevel = SCHOOL_LEVEL_BY_NAME.get(prev.school.trim());
      const nextLevel = SCHOOL_LEVEL_BY_NAME.get(value.trim());
      // Reset the grade/year level whenever switching between a high school
      // and a college/TVET school, since the previously picked value would not be
      // a valid option for the new list.
      return { ...prev, school: value, gradeLevel: prevLevel !== nextLevel ? "" : prev.gradeLevel };
    });
  };

  const handleTypeChange = (value) => {
    setFieldError("");
    setForm((prev) => ({
      ...prev,
      applicantType: value,
      school: value === "osy" ? "" : prev.school,
      gradeLevel: value === "osy" ? "" : prev.gradeLevel,
      gwa: value === "osy" ? "" : prev.gwa,
    }));
    // The academic proof and the OSY certificate swap; drop a file that no longer applies.
    setFiles((prev) => {
      const next = { ...prev };
      delete next[value === "osy" ? "proof_of_academic_standing" : "osy_certification"];
      return next;
    });
  };

  // FileUpload has already checked type and size; a bad file never reaches here, and the
  // other slots keep their files either way.
  const clearSlotError = (slot) =>
    setSlotErrors((prev) => {
      if (!prev[slot]) return prev;
      const next = { ...prev };
      delete next[slot];
      return next;
    });

  const handleFileSelect = (slot, file) => {
    setFieldError("");
    setSubmitError("");
    clearSlotError(slot);
    setFiles((prev) => ({ ...prev, [slot]: file }));
  };

  const handleFileRemove = (slot) => {
    clearSlotError(slot);
    setFiles((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  // Closing (X, Esc, backdrop, Cancel) asks first when it would throw away chosen files or
  // an upload in progress.
  const closeModal = async () => {
    if (confirmingRef.current) return;
    if (!submittingRef.current && Object.keys(files).length === 0) {
      onClose();
      return;
    }
    confirmingRef.current = true;
    const discard = await confirm({
      title: t("spes.apply.closeConfirmTitle"),
      message: t("spes.apply.closeConfirmBody"),
      confirmLabel: t("spes.apply.discard"),
      cancelLabel: t("spes.apply.keepEditing"),
      tone: "danger",
    });
    confirmingRef.current = false;
    if (!discard) return;
    abortRef.current?.abort();
    onClose();
  };

  const cancelSubmit = () => abortRef.current?.abort();

  const validateInfo = () => {
    if (!form.contactNumber.trim()) return "SPES_CONTACT_INVALID";
    if (!isOsy) {
      if (!form.school.trim() || !form.gradeLevel) return "SPES_STUDENT_FIELDS_REQUIRED";
      const scale = GWA_SCALES[form.gwaScale];
      const n = Number(form.gwa);
      if (form.gwa === "" || !Number.isFinite(n) || n < scale.min || n > scale.max) return "SPES_GWA_INVALID";
    }
    if (guardianRequired && (!form.guardianName.trim() || !form.guardianContact.trim())) return "SPES_GUARDIAN_REQUIRED";
    return "";
  };

  const goNext = () => {
    if (step === "info") {
      const code = validateInfo();
      if (code) {
        setFieldError(code);
        return;
      }
      setStep("docs");
    } else if (step === "docs") {
      if (!docsComplete) {
        setFieldError("SPES_DOCS_MISSING");
        return;
      }
      setStep("review");
    }
    setFieldError("");
  };

  // The API only takes documents together with the application (there is no pre-submit
  // upload endpoint), so files stay in the browser until now and go up in one request,
  // with one combined progress value.
  const handleSubmit = async () => {
    if (submittingRef.current) return; // a second click while a request is running
    submittingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setSubmitError("");
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("applicantType", form.applicantType);
      fd.append("contactNumber", form.contactNumber);
      fd.append("school", isOsy ? "" : form.school);
      fd.append("gradeLevel", isOsy ? "" : form.gradeLevel);
      if (!isOsy) {
        fd.append("gwa", form.gwa);
        fd.append("gwaScale", form.gwaScale);
      }
      fd.append("guardianName", form.guardianName);
      fd.append("guardianContact", form.guardianContact);
      slots.forEach((slot) => {
        if (files[slot]) fd.append(slot, files[slot]);
      });
      const { data } = await spesAPI.apply(posting._id, fd, {
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (event.total) setProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      toast.success(t("spes.apply.submitted"));
      onApplied(data?.application || null);
    } catch (err) {
      const code = uploadErrorCode(err);
      if (code === "UPLOAD_CANCELED") {
        toast.info(t("spes.apply.submitCanceled"));
      } else {
        const data = err?.response?.data;
        const missing = Array.isArray(data?.missingSlots) ? data.missingSlots : [];
        if (missing.length > 0) {
          setSlotErrors(Object.fromEntries(missing.map((slot) => [slot, "SPES_DOCS_MISSING"])));
        }
        setSubmitError(translateErrorCode(code, data?.message || t("spes.apply.failed")));
        // A rejected document is fixed on the documents step; connection problems can be retried here.
        if (missing.length > 0 || ["SPES_FILE_TYPE", "SPES_FILE_TOO_LARGE", "SPES_FILE_UNEXPECTED", "SPES_TOO_MANY_FILES"].includes(code)) {
          setStep("docs");
        }
      }
    } finally {
      submittingRef.current = false;
      abortRef.current = null;
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={closeModal}
      title={t("spes.apply.title")}
      titleId="spes-apply-title"
      closeLabel={t("common.close", { defaultValue: "Close" })}
      className="am--full spes-apply-overlay"
      panelClassName="spes-apply"
    >
      <nav className="spes-apply-steps" aria-label={t("spes.apply.stepsLabel")}>
        <ol className="spes-apply-steps__list">
          {STEPS.map((key, i) => {
            const state = step === key ? "is-current" : STEPS.indexOf(step) > i ? "is-done" : "";
            return (
              <Fragment key={key}>
                <li className={`spes-apply-steps__item ${state}`} aria-current={step === key ? "step" : undefined}>
                  {state === "is-done" ? (
                    <Check size={18} strokeWidth={3} className="spes-apply-steps__check" aria-hidden="true" />
                  ) : (
                    <span className="spes-apply-steps__dot" aria-hidden="true">
                      {i + 1}
                    </span>
                  )}
                  <span className="spes-apply-steps__label">{t(`spes.apply.step.${key}`)}</span>
                  {state === "is-done" ? <span className="ds-sr-only">{t("spes.apply.stepDone")}</span> : null}
                </li>
                {i < STEPS.length - 1 ? (
                  <li className={`spes-apply-steps__line${STEPS.indexOf(step) > i ? " is-done" : ""}`} role="presentation" aria-hidden="true" />
                ) : null}
              </Fragment>
            );
          })}
        </ol>
        <p className="spes-apply-steps__count">{t("spes.apply.stepOf", { current: STEPS.indexOf(step) + 1, total: STEPS.length })}</p>
      </nav>
      <span className="ds-sr-only" role="status" aria-live="polite">
        {t("spes.apply.stepOf", { current: STEPS.indexOf(step) + 1, total: STEPS.length })}: {t(`spes.apply.step.${step}`)}
      </span>

      <div className="spes-apply__scroll">
      {step === "info" ? (
        <div className="spes-apply__body spes-fields">
          <label className="spes-field">
            <span className="spes-field__label">{t("spes.apply.applicantType")}<Req /></span>
            <select aria-required="true" value={form.applicantType} onChange={(e) => handleTypeChange(e.target.value)}>
              <option value="student">{t("spes.apply.typeStudent")}</option>
              <option value="osy">{t("spes.apply.typeOsy")}</option>
            </select>
          </label>
          <label className="spes-field">
            <span className="spes-field__label">{t("spes.apply.contact")}<Req /></span>
            <input type="tel" required aria-required="true" value={form.contactNumber} onChange={(e) => updateField("contactNumber", e.target.value)} />
          </label>
          {!isOsy ? (
            <>
              <label className="spes-field spes-field--wide">
                <span className="spes-field__label">{t("spes.apply.school")}<Req /></span>
                <Autosuggest
                  id="spes-school"
                  name="school"
                  value={form.school}
                  onChange={handleSchoolChange}
                  options={MARINDUQUE_SCHOOL_OPTIONS}
                  placeholder={t("spes.apply.schoolPlaceholder")}
                />
              </label>
              <label className="spes-field spes-field--wide">
                <span className="spes-field__label">{t("spes.apply.yearLevel")}<Req /></span>
                <select aria-required="true" value={form.gradeLevel} onChange={(e) => updateField("gradeLevel", e.target.value)}>
                  <option value="">{t("spes.apply.yearLevelPlaceholder")}</option>
                  {schoolLevel !== "college" ? (
                    <optgroup label={t("spes.apply.highSchool")}>
                      {HIGHSCHOOL_GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {schoolLevel !== "highschool" ? (
                    <optgroup label={t("spes.apply.college")}>
                      {COLLEGE_YEAR_OPTIONS.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <label className="spes-field">
                <span className="spes-field__label">{t("spes.apply.gwaScale")}</span>
                <select value={form.gwaScale} onChange={(e) => updateField("gwaScale", e.target.value)}>
                  <option value="percent">{t("spes.apply.scalePercent")}</option>
                  <option value="one_to_five">{t("spes.apply.scaleOneToFive")}</option>
                </select>
              </label>
              <label className="spes-field">
                <span className="spes-field__label">{t("spes.apply.gwa")}<Req /></span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-required="true"
                  min={GWA_SCALES[form.gwaScale].min}
                  max={GWA_SCALES[form.gwaScale].max}
                  step={GWA_SCALES[form.gwaScale].step}
                  value={form.gwa}
                  onChange={(e) => updateField("gwa", e.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="spes-field">
            <span className="spes-field__label">
              {guardianRequired ? t("spes.apply.guardianName") : t("spes.apply.guardianNameOptional")}
              {guardianRequired ? <Req /> : null}
            </span>
            <input type="text" aria-required={guardianRequired ? "true" : undefined} value={form.guardianName} onChange={(e) => updateField("guardianName", e.target.value)} />
          </label>
          <label className="spes-field">
            <span className="spes-field__label">
              {guardianRequired ? t("spes.apply.guardianContact") : t("spes.apply.guardianContactOptional")}
              {guardianRequired ? <Req /> : null}
            </span>
            <input type="tel" aria-required={guardianRequired ? "true" : undefined} value={form.guardianContact} onChange={(e) => updateField("guardianContact", e.target.value)} />
          </label>
          {guardianRequired ? <p className="spes-note spes-field--wide">{t("spes.apply.guardianHint")}</p> : null}
        </div>
      ) : null}

      {step === "docs" ? (
        <div className="spes-apply__body">
          <p className="spes-note">
            {t("spes.apply.docsHint")} {t("spes.apply.docsDeferred")}
          </p>
          <p className="spes-apply__summary" role="status">
            {t("spes.apply.docsSummary", { done: addedCount, total: slots.length })}
          </p>
          {slots.map((slot) => (
            <FileUpload
              key={slot}
              label={t(`spes.docs.slot.${slot}`)}
              required
              hint={t("upload.hint.documents", { max: bytesToMb(SPES_DOC_LIMITS.maxBytes) })}
              file={files[slot] || null}
              error={slotErrors[slot] || ""}
              fileStateLabel={t("upload.ready")}
              disabled={submitting}
              onSelect={(file) => handleFileSelect(slot, file)}
              onRemove={() => handleFileRemove(slot)}
            />
          ))}
          {!docsComplete ? (
            <p id="spes-docs-needed" className="spes-note">
              {t("spes.apply.docsNeeded")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="spes-apply__body spes-review">
          <div className="spes-review__intro">
            <h4 className="spes-review__title">{t("spes.apply.reviewTitle")}</h4>
            <p className="spes-review__sub">{t("spes.apply.reviewSub")}</p>
          </div>
          <div className="spes-review__cols">
            <section className="spes-review__details" aria-labelledby="spes-review-details">
              <h5 id="spes-review-details" className="spes-review__card-title">{t("spes.apply.detailsTitle")}</h5>
              <dl className="spes-review__list">
                <div>
                  <dt>{t("spes.apply.applicantType")}</dt>
                  <dd>{isOsy ? t("spes.apply.typeOsy") : t("spes.apply.typeStudent")}</dd>
                </div>
                {form.contactNumber ? (
                  <div>
                    <dt>{t("spes.apply.contact")}</dt>
                    <dd>{form.contactNumber}</dd>
                  </div>
                ) : null}
                {!isOsy && form.school ? (
                  <div>
                    <dt>{t("spes.apply.school")}</dt>
                    <dd>{[form.school, form.gradeLevel].filter(Boolean).join(", ")}</dd>
                  </div>
                ) : null}
                {!isOsy && form.gwa !== "" ? (
                  <div>
                    <dt>{t("spes.apply.gwa")}</dt>
                    <dd>
                      {form.gwa}
                      <span className="spes-review__aside">
                        {t(form.gwaScale === "percent" ? "spes.apply.scalePercent" : "spes.apply.scaleOneToFive")}
                      </span>
                    </dd>
                  </div>
                ) : null}
                {form.guardianName ? (
                  <div>
                    <dt>{t("spes.apply.guardianNameOptional")}</dt>
                    <dd>
                      {form.guardianName}
                      {form.guardianContact ? <span className="spes-review__aside">{form.guardianContact}</span> : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="spes-review__docs" aria-labelledby="spes-review-docs">
              <header className="spes-review__docs-head">
                <h5 id="spes-review-docs" className="spes-review__card-title">{t("spes.apply.documentsTitle")}</h5>
                <span className="spes-review__count">{t("spes.apply.filesAttached", { count: addedCount })}</span>
              </header>
              <ul className="spes-review__doclist">
                {slots.map((slot) => {
                  const file = files[slot];
                  return (
                    <li key={slot} className={`spes-review__doc${file ? "" : " is-missing"}`}>
                      <span className="spes-review__doc-title">{t(`spes.docs.slotShort.${slot}`)}</span>
                      <span className="spes-review__doc-desc">{t(`spes.docs.slotDesc.${slot}`)}</span>
                      {file ? (
                        <span className="spes-review__file">
                          <FileText size={18} aria-hidden="true" />
                          <span className="spes-review__file-name" title={file.name}>{file.name}</span>
                          <span className="spes-review__file-size">{formatFileSize(file.size)}</span>
                        </span>
                      ) : (
                        <span className="spes-review__file spes-review__file--missing">
                          <TriangleAlert size={18} aria-hidden="true" />
                          <span className="spes-review__file-name">{t("spes.apply.missing")}</span>
                          <button type="button" className="spes-review__fix" onClick={() => setStep("docs")}>
                            {t("spes.apply.addMissing")}
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          <p className="spes-review__info">
            <Info size={18} aria-hidden="true" />
            <span>{t("spes.apply.replaceNote")}</span>
          </p>
        </div>
      ) : null}
      </div>

      <div className="spes-apply__status">
      {fieldError || submitError ? (
        <p className="spes-apply__error" role="alert">
          {submitError || translateErrorCode(fieldError, t("spes.apply.failed"))}
        </p>
      ) : null}

      {submitting ? (
        <div className="spes-apply__progress">
          <p className="spes-apply__progress-label">{t("spes.apply.submittingProgress", { percent: progress })}</p>
          <div
            className="fu__progress"
            role="progressbar"
            aria-label={t("spes.apply.submitting")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span className="fu__progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      </div>

      <footer className="spes-apply__footer">
        <p className="spes-apply__helper">{step === "review" ? t("spes.apply.footerHelper") : ""}</p>
        <div className="spes-apply__buttons">
          {submitting ? (
            <button type="button" className="spes-btn spes-btn--ghost" onClick={cancelSubmit}>
              {t("spes.apply.cancelSubmit")}
            </button>
          ) : step !== "info" ? (
            <button
              type="button"
              className="spes-btn spes-btn--ghost"
              onClick={() => {
                setFieldError("");
                setSubmitError("");
                setStep(step === "review" ? "docs" : "info");
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" /> {t("spes.apply.back")}
            </button>
          ) : (
            <button type="button" className="spes-btn spes-btn--ghost" onClick={closeModal}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
          )}
          {step === "review" ? (
            // aria-disabled (not disabled) while sending, so focus stays on the button inside the dialog.
            <button
              type="button"
              className="spes-btn spes-btn--primary"
              onClick={handleSubmit}
              aria-disabled={submitting}
            >
              {submitting ? <span className="spes-spinner" aria-hidden="true" /> : null}
              {submitting ? t("spes.apply.submitting") : submitError ? t("upload.retry") : t("spes.apply.submit")}
            </button>
          ) : (
            <button
              type="button"
              className="spes-btn spes-btn--primary"
              onClick={goNext}
              disabled={step === "docs" && !docsComplete}
              aria-describedby={step === "docs" && !docsComplete ? "spes-docs-needed" : undefined}
            >
              {t("spes.apply.next")}
            </button>
          )}
        </div>
      </footer>
    </AppModal>
  );
}
