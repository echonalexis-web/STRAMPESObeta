import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaUsers, FaClipboardCheck, FaExternalLinkAlt } from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { spesAPI } from "../services/api";
import { useToast } from "./feedback/context";

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
  const isResident = user?.role === "resident";
  const nsrpComplete = user?.hasCompletedOnboarding === true || user?.onboardingComplete === true;
  const deadlinePassed = spes.applicationDeadline && new Date(spes.applicationDeadline) < new Date();

  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(Boolean(user && isResident));
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ contactNumber: "", school: "", gradeLevel: "", guardianName: "" });
  const [files, setFiles] = useState([]);

  useEffect(() => {
    let active = true;
    if (!user || !isResident || !announcementId) {
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
  }, [user, isResident, announcementId]);

  const requirements = useMemo(
    () => (Array.isArray(spes.requirements) ? spes.requirements.filter(Boolean) : []),
    [spes.requirements]
  );

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("contactNumber", form.contactNumber);
      fd.append("school", form.school);
      fd.append("gradeLevel", form.gradeLevel);
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
    if (!isResident) {
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
      <button type="button" className="spes-btn" onClick={() => setShowModal(true)}>
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
            <label>
              School
              <input
                type="text"
                required
                value={form.school}
                onChange={(e) => updateField("school", e.target.value)}
              />
            </label>
            <label>
              Year / grade level
              <input
                type="text"
                value={form.gradeLevel}
                onChange={(e) => updateField("gradeLevel", e.target.value)}
              />
            </label>
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
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
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
