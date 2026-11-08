import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../context/AuthContext";
import { spesAPI } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import { checkSpesFile, requiredSlotsFor } from "../utils/spesSlots";
import { useToast } from "./feedback/context";
import AppModal from "./AppModal";
import Autosuggest from "./Autosuggest";
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

// The 3-step apply dialog (your details, typed documents, review and submit) for one
// SPES posting. The server re-checks everything; `guardianRequired` comes from the
// posting's eligibility response (it is true only for applicants under 18).
export default function SpesApplyFlow({ isOpen, onClose, posting, guardianRequired, onApplied }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const toast = useToast();

  const [step, setStep] = useState("info");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, contactNumber: user?.phone || "" }));
  const [files, setFiles] = useState({});
  const [fieldError, setFieldError] = useState("");

  const isOsy = form.applicantType === "osy";
  const slots = requiredSlotsFor(posting, form.applicantType);
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

  const closeModal = () => {
    if (!submitting) onClose();
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

  const goNext = () => {
    if (step === "info") {
      const code = validateInfo();
      if (code) {
        setFieldError(code);
        return;
      }
      setStep("docs");
    } else if (step === "docs") {
      if (slots.some((slot) => !files[slot])) {
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
      const { data } = await spesAPI.apply(posting._id, fd);
      toast.success(t("spes.apply.submitted"));
      onApplied(data?.application || null);
    } catch (err) {
      const data = err?.response?.data;
      toast.error(translateErrorCode(data?.code, data?.message || t("spes.apply.failed")));
      if (data?.code === "SPES_DOCS_MISSING") setStep("docs");
    } finally {
      setSubmitting(false);
    }
  };

  const fileSummary = (slot) => files[slot]?.name || t("spes.apply.noFile");

  return (
    <AppModal
      isOpen={isOpen}
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
  );
}
