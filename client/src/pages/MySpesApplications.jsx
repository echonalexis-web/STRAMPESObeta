import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { spesAPI } from "../services/api";
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

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

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

  return (
    <main className="spes-page">
      <h1>My SPES Applications</h1>

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
        return (
          <article key={app._id} className="spes-card">
            <h2>{title}</h2>
            <p className="spes-card__meta">Applied {formatDate(app.createdAt)}</p>
            <span className={`spes-chip spes-chip--${app.status}`}>
              {STATUS_LABEL[app.status] || app.status}
            </span>

            {released ? (
              <div className={`spes-result spes-result--${app.result.outcome}`} style={{ marginTop: "0.75rem" }}>
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

            {Array.isArray(app.documents) && app.documents.length > 0 ? (
              <p className="spes-card__meta" style={{ marginTop: "0.6rem" }}>
                {app.documents.length} document{app.documents.length === 1 ? "" : "s"} submitted
              </p>
            ) : null}
          </article>
        );
      })}
    </main>
  );
}
