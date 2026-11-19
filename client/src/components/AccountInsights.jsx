import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import { actionKey, insightsKind, lockState } from "../utils/insightsFormat";
import "../styles/account-insights.css";

const dateOnly = (value) => (value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);
const dateTime = (value) =>
  value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

function Row({ label, children }) {
  return (
    <div className="ai-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Read-only, server-computed supervision figures for one employer or jobseeker
// (superadmin only; the server enforces it). Plus the internal notes editor.
export default function AccountInsights({ userId }) {
  const { t } = useTranslation();
  const uid = useId();
  const [state, setState] = useState({ status: "loading", insights: null });
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState("idle");

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminAPI
      .getUserInsights(userId)
      .then(({ data }) => {
        if (cancelled) return;
        setState({ status: "ready", insights: data.insights });
        setNotes(data.insights?.notes || "");
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", insights: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  const saveNotes = async (event) => {
    event.preventDefault();
    setSaveState("saving");
    try {
      const { data } = await adminAPI.saveUserNotes(userId, notes);
      setNotes(data.notes ?? notes);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const i18n = (key, opts) => t(`superadmin.users.insights.${key}`, opts);

  if (state.status === "loading") {
    return (
      <section className="ai" aria-busy="true">
        <h2>{i18n("title")}</h2>
        <p role="status">{i18n("loading")}</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="ai">
        <h2>{i18n("title")}</h2>
        <p role="alert">{i18n("error")}</p>
        <button
          type="button"
          className="ai-btn"
          onClick={() => {
            setState({ status: "loading", insights: null });
            setReloadKey((key) => key + 1);
          }}
        >
          {i18n("retry")}
        </button>
      </section>
    );
  }

  const { insights } = state;
  const kind = insightsKind(insights);
  const { account, security, reports, appeals, statusHistory, timeline } = insights;
  const lock = lockState(security);
  const js = insights.jobseeker;
  const em = insights.employer;

  return (
    <section className="ai" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>{i18n("title")}</h2>
      <p className="ai-sub">{i18n("subtitle")}</p>

      <div className="ai-grid">
        <article className="ai-card">
          <h3>{i18n("account")}</h3>
          <dl>
            <Row label={i18n("accountType")}>
              <span className={`ai-pill ai-pill--${account.accountType}`}>{i18n(`types.${account.accountType}`)}</span>
              <small>{i18n(`typeHelp.${account.accountType}`)}</small>
            </Row>
            <Row label={i18n("state")}>{t(`superadmin.users.status.${account.state}`)}</Row>
            <Row label={i18n("username")}>{account.username || "—"}</Row>
            <Row label={i18n("email")}>
              {account.email
                ? account.email
                : account.hasEmail
                  ? i18n("emailHidden")
                  : i18n("noEmail")}
              {account.hasEmail && !account.emailVerified ? <small>{i18n("emailUnverified")}</small> : null}
            </Row>
            <Row label={i18n("joined")}>{dateOnly(account.createdAt) || "—"}</Row>
            <Row label={i18n("lastLogin")}>{dateTime(account.lastLoginAt) || i18n("never")}</Row>
            <Row label={i18n("lastActive")}>{dateTime(account.lastActiveAt) || i18n("never")}</Row>
          </dl>
        </article>

        <article className="ai-card">
          <h3>{i18n("security")}</h3>
          <dl>
            <Row label={i18n("failedLogins")}>{security.failedLoginCount}</Row>
            <Row label={i18n("lockedNow")}>
              {lock.locked ? (
                <strong>{i18n("lockedUntil", { date: dateTime(lock.until) })}</strong>
              ) : (
                i18n("notLocked")
              )}
            </Row>
          </dl>
        </article>

        {kind === "jobseeker" && (
          <article className="ai-card ai-card--wide">
            <h3>{i18n("jobseeker")}</h3>
            <dl>
              <Row label={i18n("completeness")}>
                <div className="ai-meter" role="img" aria-label={`${js.profileCompleteness.percent}%`}>
                  <span style={{ width: `${js.profileCompleteness.percent}%` }} />
                </div>
                <strong>{js.profileCompleteness.percent}%</strong>
                <small>
                  {js.profileCompleteness.missingSections.length
                    ? `${i18n("missing")}: ${js.profileCompleteness.missingSections.map((s) => i18n(`missingSections.${s}`)).join(", ")}`
                    : i18n("nothingMissing")}
                </small>
              </Row>
              <Row label={i18n("ageBracket")}>{i18n(`brackets.${js.ageBracket}`)}</Row>
              <Row label={i18n("spes")}>{js.spesEligible ? i18n("yes") : i18n("no")}</Row>
              <Row label={i18n("applications")}>
                {i18n("applicationsLine", js.applications)}
              </Row>
              <Row label={i18n("lastApplication")}>{dateOnly(js.applications.lastApplicationAt) || i18n("never")}</Row>
              <Row label={i18n("savedJobs")}>{js.savedJobs}</Row>
              <Row label={i18n("skills")}>{js.skillsCount}</Row>
              <Row label={i18n("idle")}>{js.idle90Days ? i18n("yes") : i18n("no")}</Row>
            </dl>
          </article>
        )}

        {kind === "employer" && (
          <article className="ai-card ai-card--wide">
            <h3>{i18n("employer")}</h3>
            <dl>
              <Row label={i18n("verification")}>
                {em.verification.status}{" "}
                <small>
                  {em.verification.reviewedAt
                    ? i18n("reviewedOn", { date: dateOnly(em.verification.reviewedAt) })
                    : i18n("notReviewed")}
                </small>
              </Row>
              <Row label={i18n("postings")}>{i18n("postingsLine", em.postings)}</Row>
              <Row label={i18n("applicants")}>{em.applicantsReceived}</Row>
              <Row label={i18n("hires")}>{em.hires}</Row>
              <Row label={i18n("timeToHire")}>
                {em.averageDaysToHire === null ? i18n("noHires") : i18n("days", { count: em.averageDaysToHire })}
              </Row>
              <Row label={i18n("hireShare")}>{em.hireShare}%</Row>
            </dl>
          </article>
        )}

        <article className="ai-card">
          <h3>{i18n("statusHistory")}</h3>
          {statusHistory.length === 0 ? (
            <p>{i18n("noStatusHistory")}</p>
          ) : (
            <ul className="ai-list">
              {statusHistory.map((entry, index) => (
                <li key={`${entry.action}-${entry.at}-${index}`}>
                  <strong>{i18n(`actions.${actionKey(entry.action)}`, { defaultValue: entry.action })}</strong>{" "}
                  <time dateTime={entry.at}>{dateTime(entry.at)}</time>
                  <small>
                    {entry.byName ? i18n("by", { name: entry.byName }) : i18n("byRole", { role: entry.byRole })}
                    {entry.reason ? ` · ${i18n("reasonLine", { reason: entry.reason })}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="ai-card">
          <h3>{i18n("timeline")}</h3>
          {timeline.length === 0 ? (
            <p>{i18n("noTimeline")}</p>
          ) : (
            <ul className="ai-list">
              {timeline.map((entry, index) => (
                <li key={`${entry.action}-${entry.at}-${index}`}>
                  <strong>{i18n(`actions.${actionKey(entry.action)}`, { defaultValue: entry.action })}</strong>{" "}
                  <time dateTime={entry.at}>{dateTime(entry.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="ai-card">
          <h3>{i18n("reports")}</h3>
          <p>{i18n("reportsAgainst", { count: reports.againstCount })}</p>
          <ul className="ai-list">
            {reports.against.map((r, index) => (
              <li key={`a-${index}`}>{r.category} · {r.status} · {i18n("outcome", { outcome: r.outcome })}</li>
            ))}
          </ul>
          <p>{i18n("reportsFiled", { count: reports.filedCount })}</p>
          <ul className="ai-list">
            {reports.filed.map((r, index) => (
              <li key={`f-${index}`}>{r.category} · {r.status} · {i18n("outcome", { outcome: r.outcome })}</li>
            ))}
          </ul>
        </article>

        <article className="ai-card">
          <h3>{i18n("appeals")}</h3>
          {appeals.length === 0 ? (
            <p>{i18n("noAppeals")}</p>
          ) : (
            <ul className="ai-list">
              {appeals.map((a, index) => (
                <li key={index}>{a.accountStatus} · {a.status} · {dateOnly(a.createdAt)}</li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <form className="ai-notes" onSubmit={saveNotes}>
        <label htmlFor={`${uid}-notes`}><h3>{i18n("notes")}</h3></label>
        <textarea
          id={`${uid}-notes`}
          rows={4}
          maxLength={2000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaveState("idle");
          }}
          aria-describedby={`${uid}-notes-hint ${uid}-notes-status`}
        />
        <small id={`${uid}-notes-hint`}>{i18n("notesHint")}</small>
        <div className="ai-notes__actions">
          <button type="submit" className="ai-btn ai-btn--primary" disabled={saveState === "saving"}>
            {saveState === "saving" ? i18n("notesSaving") : i18n("notesSave")}
          </button>
          <span id={`${uid}-notes-status`} role="status" aria-live="polite">
            {saveState === "saved" ? i18n("notesSaved") : saveState === "error" ? i18n("notesError") : ""}
          </span>
        </div>
      </form>
    </section>
  );
}
