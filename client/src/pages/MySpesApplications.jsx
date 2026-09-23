import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, FileText, Sparkles, Download } from "lucide-react";
import { spesAPI } from "../services/api";
import SecureFileLink from "../components/SecureFileLink";
import "../styles/spes.css";

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

// The 5-stage lifecycle actually tracked by the platform. for_exam and
// for_interview collapse into one visual stage since both are the same
// offline step from the applicant's point of view.
const SPES_STAGES = [
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Document Review" },
  { key: "exam_interview", label: "Exam & Interview" },
  { key: "evaluated", label: "Evaluated" },
  { key: "results_released", label: "Results Released" },
];

const STAGE_INDEX_BY_STATUS = {
  submitted: 0,
  under_review: 1,
  for_exam: 2,
  for_interview: 2,
  evaluated: 3,
  results_released: 4,
};

const NEXT_STEP_COPY = {
  submitted: "Your application was received. The PESO office will review your documents next.",
  under_review:
    "Your documents are being reviewed. You'll be notified here once you're scheduled for the exam and interview.",
  for_exam: "You're scheduled for the qualifying exam — watch this page and your notifications for the schedule.",
  for_interview: "You're scheduled for the interview — watch this page and your notifications for the schedule.",
  evaluated: "Your exam and interview are done. Results will be posted here once the program releases them.",
  results_released: "Results are released — see your outcome below.",
  withdrawn: "This application was withdrawn.",
  disqualified: "This application was marked disqualified. Contact your PESO office for details.",
};

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function SpesStepper({ status }) {
  if (status === "withdrawn" || status === "disqualified") {
    return (
      <div className={`spes-stepper-terminal spes-stepper-terminal--${status}`}>
        {STATUS_LABEL[status] || status}
      </div>
    );
  }

  const activeIndex = STAGE_INDEX_BY_STATUS[status] ?? 0;
  return (
    <ol className="spes-stepper">
      {SPES_STAGES.map((stage, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
        return (
          <li key={stage.key} className={`spes-stepper__item spes-stepper__item--${state}`}>
            <span className="spes-stepper__dot">
              {state === "done" ? <CheckCircle2 size={16} /> : state === "active" ? <Clock size={16} /> : i + 1}
            </span>
            <span className="spes-stepper__label">{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function MySpesApplications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await spesAPI.getMine();
        if (active) setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (err) {
        if (active) setError(err?.response?.data?.message || "Failed to load your SPES applications.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const mostRecent = items[0] || null;

  return (
    <main className="spes-page">
      <div className="spes-page__banner">
        <div>
          <h1>My SPES Applications</h1>
          <p className="spes-note">Track the status of every SPES program you've applied to.</p>
        </div>
        <div className="spes-summary-strip">
          <div className="spes-summary-stat">
            <strong>{items.length}</strong>
            <span>Application{items.length === 1 ? "" : "s"}</span>
          </div>
          {mostRecent ? (
            <div className="spes-summary-stat spes-summary-stat--program">
              <span className="spes-summary-stat__label">Most recent</span>
              <strong>{mostRecent.announcement?.title || "SPES program"}</strong>
              <span className={`spes-chip spes-chip--${mostRecent.status}`}>
                {STATUS_LABEL[mostRecent.status] || mostRecent.status}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? <p className="spes-note">Loading…</p> : null}
      {!loading && error ? <p className="spes-note">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="spes-note">
          You have no SPES applications yet. Find a SPES program in the{" "}
          <Link to="/news">news feed</Link>.
        </p>
      ) : null}

      {items.map((app) => {
        const released = app.status === "results_released" && app.result;
        const title = app.announcement?.title || "SPES program";
        const documents = Array.isArray(app.documents) ? app.documents : [];
        return (
          <article key={app._id} className="spes-card">
            <div className="spes-card__head">
              <div>
                <h2>{title}</h2>
                <p className="spes-card__meta">Applied {formatDate(app.createdAt)}</p>
              </div>
              <span className={`spes-chip spes-chip--${app.status}`}>{STATUS_LABEL[app.status] || app.status}</span>
            </div>

            <SpesStepper status={app.status} />

            <div className="spes-card__grid">
              <div className="spes-card__panel">
                <h3>
                  <FileText size={15} aria-hidden="true" /> Documents submitted
                </h3>
                {documents.length === 0 ? (
                  <p className="spes-note">No documents on file.</p>
                ) : (
                  <ul className="spes-doc-list">
                    {documents.map((doc, i) => (
                      <li key={i}>
                        <CheckCircle2 size={14} className="spes-doc-list__icon" aria-hidden="true" />
                        <span className="spes-doc-list__label">{doc.label || `Document ${i + 1}`}</span>
                        <SecureFileLink className="spes-doc-list__link" value={doc.fileUrl}>
                          <Download size={12} /> View
                        </SecureFileLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="spes-card__panel spes-card__panel--highlight">
                <h3>
                  <Sparkles size={15} aria-hidden="true" /> Next step
                </h3>
                <p>{NEXT_STEP_COPY[app.status] || "Check back here for updates."}</p>

                {released ? (
                  <div className={`spes-result spes-result--${app.result.outcome}`}>
                    <strong>{OUTCOME_LABEL[app.result.outcome] || app.result.outcome}</strong>
                    {app.result.remarks ? <p>{app.result.remarks}</p> : null}
                    {app.announcement?.spes?.resultsSummary ? <p>{app.announcement.spes.resultsSummary}</p> : null}
                    {app.announcement?.spes?.resultsUrl ? (
                      <p>
                        <a href={app.announcement.spes.resultsUrl} target="_blank" rel="noreferrer">
                          Official results (Facebook)
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </main>
  );
}
