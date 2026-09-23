import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaUsers, FaClipboardCheck, FaExternalLinkAlt } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { spesAPI } from "../services/api";
import { useToast } from "./feedback/context";
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

const STATUS_LABEL = {
  submitted: "Submitted — awaiting review",
  under_review: "Under review",
  for_exam: "Scheduled for exam",
  for_interview: "Scheduled for interview",
  evaluated: "Evaluation complete — results pending",
  results_released: "Results released",
  withdrawn: "Withdrawn",
  disqualified: "Disqualified",
};

const OUTCOME_LABEL = {
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  not_accepted: "Not accepted",
  pending: "Pending",
};

// Mirrors DocumentDropzone.jsx's validate(file) pattern — reject obviously
// wrong/too-large files before spending a full upload round-trip on limited
// mobile data, instead of only finding out once the server rejects it.
const SPES_ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];
const SPES_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, matching the server's per-file limit

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

export default function SpesPanel({ announcement }) {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const toast = useToast();

  const spes = announcement?.spes || {};
  const announcementId = announcement?._id;
  const isJobseeker = user?.role === "jobseeker";
  const nsrpComplete = user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;
  const deadlinePassed = spes.applicationDeadline && new Date(spes.applicationDeadline) < new Date();

  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(Boolean(user && isJobseeker));
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    contactNumber: "",
    isOutOfSchoolYouth: false,
    school: "",
    gradeLevel: "",
    guardianName: "",
  });
  const [files, setFiles] = useState([]);

  useEffect(() => {
    let active = true;
    if (!user || !isJobseeker || !announcementId) {
      setLoading(false);
      return () => {};
    }
    (async () => {
      try {
        const { data } = await spesAPI.getForAnnouncement(announcementId);
        if (active) setApplication(data?.application || null);
      } catch (_) {
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

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const schoolLevel = SCHOOL_LEVEL_BY_NAME.get(form.school.trim());

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

  const handleOutOfSchoolToggle = (checked) => {
    setForm((prev) => ({
      ...prev,
      isOutOfSchoolYouth: checked,
      school: checked ? "" : prev.school,
      gradeLevel: checked ? "" : prev.gradeLevel,
    }));
  };

  const handleFilesSelected = (fileList) => {
    const picked = Array.from(fileList || []);
    const valid = [];
    for (const file of picked) {
      if (!SPES_ALLOWED_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" is not a PDF, DOC, DOCX, JPG, or PNG file and was not added.`);
        continue;
      }
      if (file.size > SPES_MAX_FILE_SIZE) {
        toast.error(`"${file.name}" is too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(SPES_MAX_FILE_SIZE)}.`);
        continue;
      }
      valid.push(file);
    }
    setFiles(valid.slice(0, 4));
  };

  const openApplyModal = () => {
    // Prefill from the jobseeker's own profile so they don't have to retype
    // it; only fills in an empty field, never clobbers something they'd
    // already typed in a previous open of this modal.
    setForm((prev) => ({ ...prev, contactNumber: prev.contactNumber || user?.phone || "" }));
    setShowModal(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!form.contactNumber.trim() || (!form.isOutOfSchoolYouth && !form.school.trim())) {
      toast.error(
        form.isOutOfSchoolYouth ? "Contact number is required." : "Contact number and school are required."
      );
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("contactNumber", form.contactNumber);
      fd.append("isOutOfSchoolYouth", form.isOutOfSchoolYouth ? "true" : "false");
      fd.append("school", form.isOutOfSchoolYouth ? "" : form.school);
      fd.append("gradeLevel", form.isOutOfSchoolYouth ? "" : form.gradeLevel);
      fd.append("guardianName", form.guardianName);
      files.slice(0, 4).forEach((file) => fd.append("documents", file));
      const { data } = await spesAPI.apply(announcementId, fd);
      setApplication(data?.application || null);
      setShowModal(false);
      toast.success("SPES application submitted.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderAction = () => {
    if (!user) {
      return (
        <button type="button" className="spes-btn" onClick={() => navigate("/login")}>
          Log in to apply
        </button>
      );
    }
    if (!isJobseeker) {
      return <p className="spes-note">SPES applications are open to jobseeker accounts only.</p>;
    }
    if (loading) return <p className="spes-note">Checking your application…</p>;

    if (application) {
      const released = application.status === "results_released" && application.result;
      return (
        <div className="spes-status-box">
          <span className={`spes-chip spes-chip--${application.status}`}>
            {STATUS_LABEL[application.status] || application.status}
          </span>
          {released ? (
            <div className={`spes-result spes-result--${application.result.outcome}`}>
              <strong>{OUTCOME_LABEL[application.result.outcome] || application.result.outcome}</strong>
              {application.result.remarks ? <p>{application.result.remarks}</p> : null}
            </div>
          ) : null}
          <button type="button" className="spes-btn spes-btn--ghost" onClick={() => navigate("/spes/applications")}>
            View my SPES applications
          </button>
        </div>
      );
    }

    if (deadlinePassed) {
      return <p className="spes-note">The application deadline has passed.</p>;
    }
    if (!nsrpComplete) {
      return (
        <button type="button" className="spes-btn" onClick={() => navigate("/onboarding")}>
          Complete your NSRP profile first
        </button>
      );
    }
    return (
      <button type="button" className="spes-btn" onClick={openApplyModal}>
        Apply for SPES
      </button>
    );
  };

  return (
    <section className="spes-panel" aria-label="SPES program">
      <h2 className="spes-panel__title">SPES Program</h2>
      <ul className="spes-meta">
        {spes.applicationDeadline ? (
          <li>
            <FaCalendarAlt aria-hidden="true" /> Deadline: {formatDate(spes.applicationDeadline)}
          </li>
        ) : null}
        {spes.slots ? (
          <li>
            <FaUsers aria-hidden="true" /> {spes.slots} slot{Number(spes.slots) === 1 ? "" : "s"}
          </li>
        ) : null}
      </ul>

      {requirements.length > 0 ? (
        <div className="spes-reqs">
          <p className="spes-reqs__label">
            <FaClipboardCheck aria-hidden="true" /> Requirements to submit
          </p>
          <ul>
            {requirements.map((req) => (
              <li key={req}>{req}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="spes-note">
        Applicants complete the NSRP profile, submit requirements, then sit an exam and interview.
        Results are released here on the platform.
        {spes.resultsUrl ? (
          <>
            {" "}
            <a href={spes.resultsUrl} target="_blank" rel="noreferrer">
              Facebook page <FaExternalLinkAlt aria-hidden="true" />
            </a>
          </>
        ) : null}
      </p>

      {renderAction()}

      {showModal ? (
        <div className="spes-modal-overlay" onClick={() => !submitting && setShowModal(false)}>
          <form className="spes-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <h3>Apply for SPES</h3>
            <label>
              Contact number
              <input
                type="tel"
                required
                value={form.contactNumber}
                onChange={(e) => updateField("contactNumber", e.target.value)}
              />
            </label>
            <label className="spes-checkbox-label">
              <input
                type="checkbox"
                checked={form.isOutOfSchoolYouth}
                onChange={(e) => handleOutOfSchoolToggle(e.target.checked)}
              />
              I'm an out-of-school youth (not currently enrolled)
            </label>
            {!form.isOutOfSchoolYouth ? (
              <>
                <label>
                  School
                  <Autosuggest
                    id="spes-school"
                    name="school"
                    value={form.school}
                    onChange={handleSchoolChange}
                    options={MARINDUQUE_SCHOOL_OPTIONS}
                    placeholder="Start typing your school's name"
                  />
                </label>
                <label>
                  Year / grade level
                  <select value={form.gradeLevel} onChange={(e) => updateField("gradeLevel", e.target.value)}>
                    <option value="">Select year / grade level</option>
                    {schoolLevel !== "college" ? (
                      <optgroup label="High School">
                        {HIGHSCHOOL_GRADE_OPTIONS.map((grade) => (
                          <option key={grade} value={grade}>
                            {grade}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {schoolLevel !== "highschool" ? (
                      <optgroup label="College / TVET">
                        {COLLEGE_YEAR_OPTIONS.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
              </>
            ) : null}
            <label>
              Parent / guardian name
              <input
                type="text"
                value={form.guardianName}
                onChange={(e) => updateField("guardianName", e.target.value)}
              />
            </label>
            <label>
              Requirement documents (up to 4)
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,image/jpeg,image/png"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              {files.length > 0 && (
                <span className="spes-file-summary">
                  {files.length} file{files.length === 1 ? "" : "s"} selected
                </span>
              )}
            </label>
            <div className="spes-modal__actions">
              <button type="button" className="spes-btn spes-btn--ghost" onClick={() => setShowModal(false)} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="spes-btn" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
