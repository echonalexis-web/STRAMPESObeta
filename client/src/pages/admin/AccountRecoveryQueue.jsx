import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../../context/AuthContext";
import { staffRecoveryAPI } from "../../services/api";
import IdEvidence from "../../components/IdEvidence";
import { IdOcrSummary } from "../../components/IdOcrReview";
import StateBlock from "../../components/StateBlock";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/idOcr.css";

export default function AccountRecoveryQueue() {
  const { t } = useTranslation();
  const { user: actor } = useContext(AuthContext);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState([]);
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [matched, setMatched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    staffRecoveryAPI.list(status, page).then(({ data }) => { if (alive) setRequests(data.requests); }).catch(() => { if (alive) setError(t("staffRecovery.error")); });
    return () => { alive = false; };
  }, [status, page, revision, t]);
  const open = async (id) => {
    setDetail(null); setPassword(""); setReason(""); setMatched(false); setError("");
    try { const { data } = await staffRecoveryAPI.detail(id); setDetail(data); }
    catch { setError(t("staffRecovery.error")); }
  };
  const decide = async (decision) => {
    setSaving(true); setError("");
    try {
      await staffRecoveryAPI.review(detail.request._id, { decision, revision: detail.request.revision, currentPassword: password, reason, identityMatched: matched });
      setDetail(null); setPassword(""); setRevision((value) => value + 1);
    } catch (err) { setError(err.response?.data?.message || t("staffRecovery.error")); }
    finally { setSaving(false); }
  };
  const loadReport = async (reportPage = 1) => {
    try { const { data } = await staffRecoveryAPI.report(reportPage); setReport(data); }
    catch { setError(t("staffRecovery.error")); }
  };
  const recovery = detail?.request;
  const user = detail?.user;
  const allowed = user?.role === "jobseeker" && user.isActive !== false && user.validIdFile && recovery?.contactVerifiedAt && matched;
  return <div className="admin-page-container recovery-queue"><AdminHeader title={t("staffRecovery.queue")} description={t("staffRecovery.policy")} />
    {error && <p className="ds-alert ds-alert--error recovery-queue__alert" role="alert">{error}</p>}
    <section className="admin-panel-card id-ocr">
      <label className="recovery-queue__filter">{t("staffRecovery.status")} <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{["pending", "under_review", "approved", "rejected", "expired"].map((key) => <option key={key} value={key}>{t(`staffRecovery.statuses.${key}`)}</option>)}</select></label>
      <ul className="recovery-queue__list">
        {requests.map((request) => (
          <li key={request._id}>
            <button type="button" className="recovery-queue__item" onClick={() => open(request._id)}>
              <span className="recovery-queue__name">{request.fullName}</span>{" "}
              <span className="recovery-queue__meta">{request.claimedIdentifier}</span>{" "}
              <span className={`recovery-queue__chip${request.contactVerifiedAt ? " is-verified" : ""}`}>
                {t(`staffRecovery.${request.contactVerifiedAt ? "verified" : "unverified"}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!requests.length && <StateBlock kind="empty" className="recovery-queue__state" title={t("staffRecovery.empty")} />}
      <div className="recovery-queue__pager">
        <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t("staffRecovery.previous")}</button>
        <span className="recovery-queue__page"> {page} </span>
        <button disabled={requests.length < 25} onClick={() => setPage((value) => value + 1)}>{t("staffRecovery.next")}</button>
      </div>
      {actor?.role === "superadmin" && <button onClick={() => loadReport()}>{t("staffRecovery.report")}</button>}
      {report && <div><ul>{report.requests.map((entry) => <li key={entry._id}>{entry.resolvedUser} · {t(`staffRecovery.statuses.${entry.status}`)} · {entry.resolvedAt} · {entry.reviewedBy}</li>)}</ul><button disabled={report.page === 1} onClick={() => loadReport(report.page - 1)}>{t("staffRecovery.previous")}</button><button disabled={!report.hasMore} onClick={() => loadReport(report.page + 1)}>{t("staffRecovery.next")}</button></div>}
    </section>
    {recovery && <section className="admin-panel-card id-ocr">
      <h2>{recovery.fullName}</h2>
      <p>{t("staffRecovery.reviewHint")}</p>
      <div className="id-ocr-grid">
        <div><h3>{t("staffRecovery.submitted")}</h3><p>{recovery.contactEmail} · {recovery.phone}</p><p>{recovery.lastKnownAddress}</p><p>{recovery.idTypeDeclared} · {recovery.idNumberDeclared}</p>
          <IdEvidence key={recovery.governmentIdFile} value={recovery.governmentIdFile} label={t("staffRecovery.fields.governmentIdFile")} /><IdEvidence key={recovery.selfieFile} value={recovery.selfieFile} label={t("staffRecovery.fields.selfieFile")} />
          <IdOcrSummary ocr={recovery.ocr} />
        </div>
        <div><h3>{t("staffRecovery.onFile")}</h3>{user ? <>
          <p>{user.name} · {user.role} · {user.authProvider}</p><p>{t("staffRecovery.created")}: {user.createdAt}</p><p>{t("staffRecovery.lastLogin")}: {user.lastLoginAt || t("staffRecovery.unknown")}</p><p>{t("staffRecovery.applications")}: {detail.totalApplications}</p>
          <p>{user.governmentIdType} · {user.governmentIdNumber}</p><IdEvidence key={user.validIdFile} value={user.validIdFile} label={t("staffRecovery.fields.governmentIdFile")} /><IdOcrSummary ocr={user.governmentIdOcr} />
        </> : <p>{t("staffRecovery.noAccount")}</p>}</div>
      </div>
      <table className="admin-table"><thead><tr><th>{t("staffRecovery.field")}</th><th>{t("staffRecovery.submitted")}</th><th>{t("staffRecovery.onFile")}</th><th>{t("staffRecovery.match")}</th></tr></thead><tbody>{[["fullName", recovery.fullName, user?.name], ["dateOfBirth", recovery.dateOfBirth?.slice(0, 10), user?.dateOfBirth?.slice(0, 10)], ["idNumberDeclared", recovery.idNumberDeclared, user?.governmentIdNumber]].map(([key, submitted, onFile]) => <tr key={key}><th>{t(`staffRecovery.fields.${key}`)}</th><td>{submitted || "—"}</td><td>{onFile || "—"}</td><td>{t(`staffRecovery.${submitted && onFile ? submitted.toLowerCase() === onFile.toLowerCase() ? "yes" : "no" : "unknown"}`)}</td></tr>)}</tbody></table>
      {["pending", "under_review"].includes(recovery.status) && <div className="id-ocr-grid">
        <label>{t("staffRecovery.reason")}<textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label>{t("staffRecovery.currentPassword")}<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label><input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} />{t("staffRecovery.identityMatched")}</label>
        <div><button disabled={saving || !password} onClick={() => decide("under_review")}>{t("staffRecovery.review")}</button><button disabled={saving || !password || reason.trim().length < 10} onClick={() => decide("reject")}>{t("staffRecovery.reject")}</button><button disabled={saving || !password || !allowed || reason.trim().length < 10} onClick={() => decide("approve")}>{t("staffRecovery.approve")}</button></div>
      </div>}
    </section>}
  </div>;
}
