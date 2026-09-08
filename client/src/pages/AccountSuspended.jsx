import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appealAPI } from "../services/api";
import "../styles/suspended.css";
import { FaBan, FaShieldAlt, FaPaperPlane } from "react-icons/fa";
import pesoLogo from "../assets/images/peso-logo.png";

const readSuspensionInfo = () => {
  try {
    return JSON.parse(localStorage.getItem("suspensionInfo") || "{}");
  } catch {
    return {};
  }
};

const formatDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
};

const APPEAL_STATUS_COPY = {
  pending: { label: "Pending review", tone: "pending" },
  under_review: { label: "Under review by LMD Admin", tone: "pending" },
  approved: { label: "Approved", tone: "approved" },
  denied: { label: "Denied", tone: "denied" },
};

export default function AccountSuspended() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(readSuspensionInfo);
  const [appeal, setAppeal] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const hasAppealSession = Boolean(localStorage.getItem("appealToken"));

  useEffect(() => {
    let active = true;

    if (!hasAppealSession) {
      setLoading(false);
      return undefined;
    }

    (async () => {
      try {
        const { data } = await appealAPI.getMine();
        if (!active) return;
        setAppeal(data.appeal || null);
        if (data.account) {
          setInfo((prev) => ({ ...prev, ...data.account }));
          if (data.account.accountStatus === "active") {
            setNotice("Good news — your account has been restored. You can log in again.");
          }
        }
      } catch {
        /* keep whatever we have from localStorage */
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [hasAppealSession]);

  const isBanned = info.accountStatus === "banned";
  const suspendedOn = useMemo(() => formatDate(info.suspendedAt), [info.suspendedAt]);

  const openAppeal =
    appeal && (appeal.status === "pending" || appeal.status === "under_review");
  const accountRestored = info.accountStatus === "active";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setError("Please describe your appeal in at least 10 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await appealAPI.submit(trimmed);
      setAppeal(data.appeal || null);
      setMessage("");
      setNotice("Your appeal has been submitted. LMD Admin will review it.");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.appeal) setAppeal(data.appeal);
      setError(data?.message || "Failed to submit your appeal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    localStorage.removeItem("appealToken");
    localStorage.removeItem("suspensionInfo");
    navigate("/login");
  };

  return (
    <div className="suspended-page">
      <div className="suspended-card">
        <img src={pesoLogo} alt="PESO Marinduque" className="suspended-logo" />

        <div className={`suspended-badge ${isBanned ? "banned" : ""}`}>
          <FaBan />
        </div>

        <h1>{isBanned ? "Your account has been banned" : "Your account has been suspended"}</h1>
        <p className="suspended-lead">
          {isBanned
            ? "Access to STRAM PESO has been permanently revoked for this account following a policy violation."
            : "Your access to STRAM PESO is temporarily disabled while an administrator reviews your account."}
        </p>

        <div className="suspended-meta">
          {info.suspensionReason ? (
            <div className="suspended-meta-row">
              <span>Reason</span>
              <strong>{info.suspensionReason}</strong>
            </div>
          ) : null}
          {suspendedOn ? (
            <div className="suspended-meta-row">
              <span>Date</span>
              <strong>{suspendedOn}</strong>
            </div>
          ) : null}
          <div className="suspended-meta-row">
            <span>Contact</span>
            <strong>LMD Admin</strong>
          </div>
        </div>

        {notice ? <div className="suspended-notice success">{notice}</div> : null}
        {error ? <div className="suspended-notice error">{error}</div> : null}

        {/* Appeal section */}
        {!hasAppealSession ? (
          <p className="suspended-hint">
            Log in again from the sign-in page to file an appeal to LMD Admin.
          </p>
        ) : loading ? (
          <p className="suspended-hint">Checking your appeal status…</p>
        ) : accountRestored ? (
          <button type="button" className="suspended-primary" onClick={backToLogin}>
            Go to login
          </button>
        ) : (
          <div className="suspended-appeal">
            <div className="suspended-appeal-head">
              <FaShieldAlt />
              <h2>Appeal to LMD Admin</h2>
            </div>

            {appeal ? (
              <div className={`suspended-appeal-status ${APPEAL_STATUS_COPY[appeal.status]?.tone || ""}`}>
                <span className="status-pill">
                  {APPEAL_STATUS_COPY[appeal.status]?.label || appeal.status}
                </span>
                <p className="submitted-on">
                  Submitted {formatDate(appeal.createdAt) || "recently"}
                </p>
                {appeal.adminResponse ? (
                  <p className="admin-response">
                    <strong>LMD Admin:</strong> {appeal.adminResponse}
                  </p>
                ) : null}
              </div>
            ) : null}

            {openAppeal ? (
              <p className="suspended-hint">
                Your appeal is in the queue. You'll be notified once LMD Admin has made a decision.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="suspended-form">
                <label htmlFor="appeal-message">
                  {appeal?.status === "denied"
                    ? "Your previous appeal was denied. You may submit another with more detail."
                    : "Explain why you believe this decision should be reviewed."}
                </label>
                <textarea
                  id="appeal-message"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Provide any context that will help LMD Admin review your account…"
                  maxLength={2000}
                  disabled={submitting}
                />
                <div className="suspended-form-foot">
                  <span>{message.length}/2000</span>
                  <button type="submit" className="suspended-primary" disabled={submitting}>
                    <FaPaperPlane />
                    {submitting ? "Submitting…" : "Submit appeal"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <button type="button" className="suspended-link" onClick={backToLogin}>
          Back to login
        </button>
      </div>
    </div>
  );
}
