import { useContext, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { reportAPI } from "../services/api";
import "../styles/report-modal.css";
import { FaFlag } from "react-icons/fa";

// Report categories, grouped loosely by what is being reported. All are offered
// regardless of target; the admin queue does the triage.
const CATEGORIES = [
  { value: "illegal_job", label: "Illegal or fake job vacancy" },
  { value: "scam_or_fee", label: "Scam / asks applicants for payment" },
  { value: "discrimination", label: "Discriminatory job requirements" },
  { value: "inappropriate_avatar", label: "Inappropriate photo or avatar" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech or threats" },
  { value: "spam", label: "Spam or advertising" },
  { value: "impersonation", label: "Impersonation / fake identity" },
  { value: "other", label: "Something else" },
];

/**
 * @param {"user"|"job"|"news_comment"|"news_post"|"message"|"avatar"} targetType
 * @param {string} targetId
 * @param {string} [targetOwnerId] - passed through when the server can't resolve it (e.g. messages)
 * @param {string} [label]
 * @param {"button"|"link"|"icon"} [variant]
 */
export default function ReportButton({
  targetType,
  targetId,
  targetOwnerId,
  label = "Report",
  variant = "link",
  className = "",
}) {
  const { user } = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Don't offer reporting to logged-out visitors or without a valid target.
  if (!user || !targetId || !targetType) return null;

  const reset = () => {
    setCategory("");
    setDetails("");
    setError("");
    setDone(false);
    setSubmitting(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!category) {
      setError("Please choose a reason.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await reportAPI.create({
        targetType,
        targetId: String(targetId),
        targetOwner: targetOwnerId || undefined,
        category,
        details: details.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not submit the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const triggerClass =
    variant === "button"
      ? "report-trigger report-trigger--button"
      : variant === "icon"
        ? "report-trigger report-trigger--icon"
        : "report-trigger report-trigger--link";

  return (
    <>
      <button
        type="button"
        className={`${triggerClass} ${className}`}
        onClick={() => setOpen(true)}
        title="Report"
      >
        <FaFlag aria-hidden="true" />
        {variant !== "icon" ? <span>{label}</span> : null}
      </button>

      {open ? (
        <div className="report-backdrop" onClick={close}>
          <div className="report-modal" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="report-done">
                <h3>Report submitted</h3>
                <p>
                  Thanks for helping keep STRAM PESO safe. An administrator will review this shortly.
                </p>
                <button type="button" className="report-primary" onClick={close}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <h3>Report this {targetType.replace(/_/g, " ")}</h3>
                <p className="report-sub">Your report is confidential. The person you report is not told who filed it.</p>

                <fieldset className="report-categories">
                  {CATEGORIES.map((c) => (
                    <label key={c.value} className={category === c.value ? "selected" : ""}>
                      <input
                        type="radio"
                        name="report-category"
                        value={c.value}
                        checked={category === c.value}
                        onChange={() => setCategory(c.value)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </fieldset>

                <label className="report-details-label" htmlFor="report-details">
                  Additional details <span>(optional)</span>
                </label>
                <textarea
                  id="report-details"
                  rows={3}
                  maxLength={1000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Add anything that will help the review…"
                />

                {error ? <div className="report-error">{error}</div> : null}

                <div className="report-actions">
                  <button type="button" className="report-secondary" onClick={close}>
                    Cancel
                  </button>
                  <button type="submit" className="report-primary" disabled={submitting}>
                    {submitting ? "Submitting…" : "Submit report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
