import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaCalendarAlt, FaUsers, FaClipboardCheck, FaExternalLinkAlt } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { spesAPI } from "../services/api";
import { isSpesEligibleAge, getAgeTier, AGE_TIERS } from "../utils/age";
import { translateErrorCode } from "../utils/apiErrors";
import { checkSpesFile, requiredSlotsFor, normalizeSpesStatus } from "../utils/spesSlots";
import { useToast } from "./feedback/context";
import AppModal from "./AppModal";
import Autosuggest from "./Autosuggest";
import marinduqueSchoolsData from "../data/marinduque_schools.json";

// Secondary schools map to the high school grade options; higher-ed and
// tech-voc schools (both organized into "years") map to the college options.
// Elementary schools are excluded — SPES applicants are high school,
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

// Deduplicated list of every high school / college / tech-voc school name in
// the directory, for the SPES "School" autosuggest field.
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

export default function SpesPanel({ announcement }) {
  const { t, i18n } = useTranslation();
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  const spes = announcement?.spes || {};
  const announcementId = announcement?._id;
  const isJobseeker = user?.role === "jobseeker";
  const nsrpComplete = user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;

  const [application, setApplication] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(Boolean(user && isJobseeker));
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState("info");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState({});
  const [fieldError, setFieldError] = useState("");

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(i18n.language?.startsWith("fil") ? "fil-PH" : "en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
  };

  useEffect(() => {
    let active = true;
    if (!user || !isJobseeker || !announcementId) {
      setLoading(false);
      return () => {};
    }
    (async () => {
      try {
        const [{ data: mine }, elig] = await Promise.all([
          spesAPI.getForAnnouncement(announcementId),
          spesAPI.getEligibility(announcementId).catch(() => ({ data: null })),
        ]);
        if (!active) return;
        setApplication(mine?.application || null);
        setEligibility(elig?.data || null);
      } catch {
        if (active) setApplication(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, isJobseeker, announcementId]);

  const requirements = useMemo(
    () => (Array.isArray(spes.requirements) ? spes.requirements.filter(Boolean) : []),
    [spes.requirements]
  );

  const isOsy = form.applicantType === "osy";
  const slots = requiredSlotsFor(spes, form.applicantType);
  const schoolLevel = SCHOOL_LEVEL_BY_NAME.get(form.school.trim());
  const guardianRequired =
    eligibility?.guardianRequired ?? getAgeTier(user?.dateOfBirth) === AGE_TIERS.MINOR;

  const updateField = (name, value) => {
    setFieldError("");
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSchoolChange = (value) => {
    setForm((prev) => {
      const prevLevel = SCHOOL_LEVEL_BY_NAME.get(prev.school.trim());
      const nextLevel = SCHOOL_LEVEL_BY_NAME.get(value.trim());
      // Reset the grade/year level whenever switching between a high school
      // and a college/TVET school, since the previously picked value (e.g.
      // "Grade 11") wouldn't be a valid option for the new list.
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

  const handleFilePick = (slot, file) => {
    if (!file) return;
    const code = checkSpesFile(file);
    if (code) {
      toast.error(translateErrorCode(code, t("spes.docs.uploadFailed")));
      return;
    }
    setFieldError("");
    setFiles((prev) => ({ ...prev, [slot]: file }));
  };

  const openApplyModal = () => {
    // Prefill from the jobseeker's own profile so they don't have to retype
    // it; only fills in an empty field, never clobbers something they'd
    // already typed in a previous open of this modal.
    setForm((prev) => ({ ...prev, contactNumber: prev.contactNumber || user?.phone || "" }));
    setStep("info");
    setFieldError("");
    setShowModal(true);
  };

  const closeModal = () => {
    if (!submitting) setShowModal(false);
  };

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

  const missingSlots = () => slots.filter((slot) => !files[slot]);

  const goNext = () => {
    if (step === "info") {
      const code = validateInfo();
      if (code) {
        setFieldError(code);
        return;
      }
      setStep("docs");
    } else if (step === "docs") {
      if (missingSlots().length > 0) {
        setFieldError("SPES_DOCS_MISSING");
        return;
      }
      setStep("review");
    }
    setFieldError("");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
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
      const { data } = await spesAPI.apply(announcementId, fd);
      setApplication(data?.application || null);
      setShowModal(false);
      toast.success(t("spes.apply.submitted"));
    } catch (err) {
      const data = err?.response?.data;
      toast.error(translateErrorCode(data?.code, data?.message || t("spes.apply.failed")));
      if (data?.code === "SPES_DOCS_MISSING") setStep("docs");
    } finally {
      setSubmitting(false);
    }
  };

  // First reason the user cannot apply, from the server's eligibility check
  // (falls back to the local age mirror while it is still loading).
  const blocker = eligibility
    ? eligibility.blockers?.find((code) => code !== "NSRP_INCOMPLETE" && code !== "SPES_ALREADY_APPLIED") || ""
    : isSpesEligibleAge(user?.dateOfBirth)
      ? ""
      : "SPES_AGE_ABOVE_MAX";
  const nsrpBlocked = eligibility ? eligibility.blockers?.includes("NSRP_INCOMPLETE") : !nsrpComplete;

  const renderAction = () => {
    if (!user) {
      return (
        <button type="button" className="spes-btn" onClick={() => navigate("/login")}>
          {t("spes.panel.loginToApply")}
        </button>
      );
    }
    if (!isJobseeker) {
      return <p className="spes-note">{t("spes.panel.jobseekersOnly")}</p>;
    }
    if (loading) return <p className="spes-note">{t("spes.panel.checking")}</p>;

    if (application) {
      const status = normalizeSpesStatus(application.status);
      const released = status === "results_released" && application.result;
      return (
        <div className="spes-status-box">
          <span className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)}</span>
          {released ? (
            <div className={`spes-result spes-result--${application.result.outcome}`}>
              <strong>{t(`spes.outcome.${application.result.outcome}`)}</strong>
              {application.result.remarks ? <p>{application.result.remarks}</p> : null}
            </div>
          ) : null}
          <button type="button" className="spes-btn spes-btn--ghost" onClick={() => navigate("/spes/applications")}>
            {t("spes.panel.viewMine")}
          </button>
        </div>
      );
    }

    if (blocker) {
      return <p className="spes-note">{translateErrorCode(blocker, t("spes.panel.notEligible"))}</p>;
    }
    if (nsrpBlocked) {
      return (
        <button type="button" className="spes-btn" onClick={() => navigate("/onboarding")}>
          {t("spes.panel.completeNsrp")}
        </button>
      );
    }
    return (
      <button type="button" className="spes-btn" onClick={openApplyModal}>
        {t("spes.panel.apply")}
      </button>
    );
  };

  const fileSummary = (slot) => files[slot]?.name || t("spes.apply.noFile");

  return (
    <section className="spes-panel" aria-label={t("spes.panel.aria")}>
      <h2 className="spes-panel__title">{t("spes.panel.title")}</h2>
      <ul className="spes-meta">
        {spes.applicationDeadline ? (
          <li>
            <FaCalendarAlt aria-hidden="true" /> {t("spes.panel.deadline", { date: formatDate(spes.applicationDeadline) })}
          </li>
        ) : null}
        {spes.slots ? (
          <li>
            <FaUsers aria-hidden="true" /> {t("spes.panel.slots", { count: Number(spes.slots) })}
          </li>
        ) : null}
      </ul>

      <div className="spes-reqs">
        <p className="spes-reqs__label">
          <FaClipboardCheck aria-hidden="true" /> {t("spes.panel.eligibilityTitle")}
        </p>
        <ul>
          <li>{t("spes.panel.eligAge", { min: eligibility?.ageRange?.min ?? 15, max: eligibility?.ageRange?.max ?? 30 })}</li>
          <li>{t("spes.panel.eligNsrp")}</li>
          <li>{t("spes.panel.eligStatus")}</li>
        </ul>
      </div>

      <div className="spes-reqs">
        <p className="spes-reqs__label">
          <FaClipboardCheck aria-hidden="true" /> {t("spes.panel.documentsTitle")}
        </p>
        <ul>
          {requiredSlotsFor(spes, "student").concat(requiredSlotsFor(spes, "osy").filter((s) => s === "osy_certification")).map((slot) => (
            <li key={slot}>{t(`spes.docs.slot.${slot}`)}</li>
          ))}
          {requirements.map((req) => (
            <li key={req}>{req}</li>
          ))}
        </ul>
      </div>

      <p className="spes-note">
        {t("spes.panel.howItWorks")}
        {spes.resultsUrl ? (
          <>
            {" "}
            <a href={spes.resultsUrl} target="_blank" rel="noreferrer">
              {t("spes.panel.facebookPage")} <FaExternalLinkAlt aria-hidden="true" />
            </a>
          </>
        ) : null}
      </p>

      {renderAction()}

      <AppModal
        isOpen={showModal}
        onClose={closeModal}
        title={t("spes.apply.title")}
        closeLabel={t("common.close", { defaultValue: "Close" })}
        panelClassName="spes-apply"
      >
        <ol className="spes-apply__steps" aria-label={t("spes.apply.stepsLabel")}>
          {STEPS.map((key, i) => (
            <li
              key={key}
              className={`spes-apply__step${step === key ? " is-active" : STEPS.indexOf(step) > i ? " is-done" : ""}`}
              aria-current={step === key ? "step" : undefined}
            >
              {i + 1}. {t(`spes.apply.step.${key}`)}
            </li>
          ))}
        </ol>

        {step === "info" ? (
          <div className="spes-apply__body">
            <label>
              {t("spes.apply.applicantType")}
              <select value={form.applicantType} onChange={(e) => handleTypeChange(e.target.value)}>
                <option value="student">{t("spes.apply.typeStudent")}</option>
                <option value="osy">{t("spes.apply.typeOsy")}</option>
              </select>
            </label>
            <label>
              {t("spes.apply.contact")}
              <input type="tel" required value={form.contactNumber} onChange={(e) => updateField("contactNumber", e.target.value)} />
            </label>
            {!isOsy ? (
              <>
                <label>
                  {t("spes.apply.school")}
                  <Autosuggest
                    id="spes-school"
                    name="school"
                    value={form.school}
                    onChange={handleSchoolChange}
                    options={MARINDUQUE_SCHOOL_OPTIONS}
                    placeholder={t("spes.apply.schoolPlaceholder")}
                  />
                </label>
                <label>
                  {t("spes.apply.yearLevel")}
                  <select value={form.gradeLevel} onChange={(e) => updateField("gradeLevel", e.target.value)}>
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
                <div className="spes-apply__row">
                  <label>
                    {t("spes.apply.gwaScale")}
                    <select value={form.gwaScale} onChange={(e) => updateField("gwaScale", e.target.value)}>
                      <option value="percent">{t("spes.apply.scalePercent")}</option>
                      <option value="one_to_five">{t("spes.apply.scaleOneToFive")}</option>
                    </select>
                  </label>
                  <label>
                    {t("spes.apply.gwa")}
                    <input
                      type="number"
                      inputMode="decimal"
                      min={GWA_SCALES[form.gwaScale].min}
                      max={GWA_SCALES[form.gwaScale].max}
                      step={GWA_SCALES[form.gwaScale].step}
                      value={form.gwa}
                      onChange={(e) => updateField("gwa", e.target.value)}
                    />
                  </label>
                </div>
              </>
            ) : null}
            <label>
              {guardianRequired ? t("spes.apply.guardianName") : t("spes.apply.guardianNameOptional")}
              <input type="text" value={form.guardianName} onChange={(e) => updateField("guardianName", e.target.value)} />
            </label>
            <label>
              {guardianRequired ? t("spes.apply.guardianContact") : t("spes.apply.guardianContactOptional")}
              <input type="tel" value={form.guardianContact} onChange={(e) => updateField("guardianContact", e.target.value)} />
            </label>
            {guardianRequired ? <p className="spes-note">{t("spes.apply.guardianHint")}</p> : null}
          </div>
        ) : null}

        {step === "docs" ? (
          <div className="spes-apply__body">
            <p className="spes-note">{t("spes.apply.docsHint")}</p>
            {slots.map((slot) => (
              <label key={slot} className="spes-apply__file">
                <span>{t(`spes.docs.slot.${slot}`)}</span>
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png"
                  onChange={(e) => handleFilePick(slot, e.target.files?.[0])}
                />
                <span className="spes-file-summary">{fileSummary(slot)}</span>
              </label>
            ))}
          </div>
        ) : null}

        {step === "review" ? (
          <div className="spes-apply__body">
            <p className="spes-note">{t("spes.apply.reviewHint")}</p>
            <dl className="spes-apply__review">
              <dt>{t("spes.apply.applicantType")}</dt>
              <dd>{isOsy ? t("spes.apply.typeOsy") : t("spes.apply.typeStudent")}</dd>
              <dt>{t("spes.apply.contact")}</dt>
              <dd>{form.contactNumber}</dd>
              {!isOsy ? (
                <>
                  <dt>{t("spes.apply.school")}</dt>
                  <dd>
                    {form.school}, {form.gradeLevel}
                  </dd>
                  <dt>{t("spes.apply.gwa")}</dt>
                  <dd>
                    {form.gwa} ({t(form.gwaScale === "percent" ? "spes.apply.scalePercent" : "spes.apply.scaleOneToFive")})
                  </dd>
                </>
              ) : null}
              {form.guardianName ? (
                <>
                  <dt>{t("spes.apply.guardianNameOptional")}</dt>
                  <dd>
                    {form.guardianName} {form.guardianContact ? `· ${form.guardianContact}` : ""}
                  </dd>
                </>
              ) : null}
              {slots.map((slot) => (
                <div key={slot} className="spes-apply__review-doc">
                  <dt>{t(`spes.docs.slot.${slot}`)}</dt>
                  <dd>{fileSummary(slot)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {fieldError ? (
          <p className="spes-apply__error" role="alert">
            {translateErrorCode(fieldError, t("spes.apply.failed"))}
          </p>
        ) : null}

        <div className="spes-modal__actions">
          {step !== "info" ? (
            <button
              type="button"
              className="spes-btn spes-btn--ghost"
              onClick={() => {
                setFieldError("");
                setStep(step === "review" ? "docs" : "info");
              }}
              disabled={submitting}
            >
              {t("spes.apply.back")}
            </button>
          ) : (
            <button type="button" className="spes-btn spes-btn--ghost" onClick={closeModal} disabled={submitting}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
          )}
          {step === "review" ? (
            <button type="button" className="spes-btn" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("spes.apply.submitting") : t("spes.apply.submit")}
            </button>
          ) : (
            <button type="button" className="spes-btn" onClick={goNext}>
              {t("spes.apply.next")}
            </button>
          )}
        </div>
      </AppModal>
    </section>
  );
}
