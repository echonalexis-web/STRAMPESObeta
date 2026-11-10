import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../../context/AuthContext";
import { staffRecoveryAPI } from "../../services/api";
import IdEvidence from "../../components/IdEvidence";
import { IdOcrSummary } from "../../components/IdOcrReview";
import StateBlock from "../../components/StateBlock";
import TemporaryPasswordPanel from "../../components/TemporaryPasswordPanel";
import { GOVERNMENT_ID_TYPES } from "../../constants/governmentIdTypes";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/idOcr.css";

// One labelled fact (label above its value); renders nothing when there is no value.
const Fact = ({ label, children }) => (children ? <div className="recovery-queue__fact"><dt>{label}</dt><dd>{children}</dd></div> : null);

// "2026-11-09T15:37:28.687Z" -> "Nov 9, 2026, 11:37 PM" in the viewer's locale.
const formatWhen = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const joinParts = (...parts) => parts.filter(Boolean).join(" · ");

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
  const [idType, setIdType] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    staffRecoveryAPI.list(status, page).then(({ data }) => { if (alive) setRequests(data.requests); }).catch(() => { if (alive) setError(t("staffRecovery.error")); });
    return () => { alive = false; };
  }, [status, page, revision, t]);
  const open = async (id) => {
    setDetail(null); setPassword(""); setReason(""); setMatched(false); setIdType(""); setTempPassword(""); setError(""); setNotice("");
    try { const { data } = await staffRecoveryAPI.detail(id); setDetail(data); }
    catch { setError(t("staffRecovery.error")); }
  };
  const decide = async (decision) => {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await staffRecoveryAPI.review(detail.request._id, { decision, revision: detail.request.revision, currentPassword: password, reason, identityMatched: matched, ...(decision === "complete_in_person" ? { idChecked: matched, idTypePresented: idType } : {}) });
      setDetail(null); setPassword(""); setRevision((value) => value + 1);
      // Completed in person: the temporary password is shown once, here, and then gone.
      if (data?.temporaryPassword) setTempPassword(data.temporaryPassword);
      // The approval is saved even when the email could not be delivered;
      // say so now, because the request moves out of the pending list.
      if (data?.delivery?.status === "failed") setError(t("staffRecovery.delivery.failedHint"));
    } catch (err) { setError(err.response?.data?.message || t("staffRecovery.error")); }
    finally { setSaving(false); }
  };
  const resend = async () => {
    setResending(true); setError(""); setNotice("");
    try {
      const { data } = await staffRecoveryAPI.resend(detail.request._id, password);
      setPassword(""); setRevision((value) => value + 1);
      setDetail((current) => current && { ...current, request: { ...current.request, delivery: { ...current.request.delivery, ...data.delivery } } });
      if (data?.delivery?.status === "sent") setNotice(t("staffRecovery.delivery.resent"));
      else setError(t("staffRecovery.delivery.resendFailed"));
    } catch (err) { setError(err.response?.data?.message || t("staffRecovery.error")); }
    finally { setResending(false); }
  };
  const loadReport = async (reportPage = 1) => {
    try { const { data } = await staffRecoveryAPI.report(reportPage); setReport(data); }
    catch { setError(t("staffRecovery.error")); }
  };
  const recovery = detail?.request;
  const user = detail?.user;
  const phoneContact = recovery?.contactMethod === "phone";
  const allowed = !phoneContact && user?.role === "jobseeker" && user.isActive !== false && user.validIdFile && recovery?.contactVerifiedAt && matched;
  const canCompleteInPerson = phoneContact && user?.role === "jobseeker" && user.isActive !== false && matched && idType && reason.trim().length >= 10;
  return <div className="admin-page-container recovery-queue"><AdminHeader title={t("staffRecovery.queue")} description={t("staffRecovery.policy")} />
    {error && <p className="ds-alert ds-alert--error recovery-queue__alert" role="alert">{error}</p>}
    {notice && <p className="ds-alert ds-alert--success recovery-queue__alert" role="status">{notice}</p>}
    <section className="admin-panel-card id-ocr">
      <label className="recovery-queue__filter">{t("staffRecovery.status")} <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>{["pending", "under_review", "approved", "rejected", "expired"].map((key) => <option key={key} value={key}>{t(`staffRecovery.statuses.${key}`)}</option>)}</select></label>
      <ul className="recovery-queue__list">
        {requests.map((request) => (
          <li key={request._id}>
            <button type="button" className="recovery-queue__item" onClick={() => open(request._id)}>
              <span className="recovery-queue__name">{request.fullName}</span>{" "}
              <span className="recovery-queue__meta">{request.claimedIdentifier}</span>{" "}
              {request.contactMethod === "phone" ? (
                <span className="recovery-queue__chip">{t("staffRecovery.phoneChip")}</span>
              ) : (
                <span className={`recovery-queue__chip${request.contactVerifiedAt ? " is-verified" : ""}`}>
                  {t(`staffRecovery.${request.contactVerifiedAt ? "verified" : "unverified"}`)}
                </span>
              )}
              {request.status === "approved" && request.delivery?.status === "failed" && (
                <>{" "}<span className="recovery-queue__chip is-failed">{t("staffRecovery.delivery.failed")}</span></>
              )}
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
    {tempPassword && <section className="admin-panel-card id-ocr"><TemporaryPasswordPanel value={tempPassword} onDone={() => setTempPassword("")} /></section>}
    {recovery && <section className="admin-panel-card id-ocr">
      <header className="recovery-queue__head">
        <h2>{recovery.fullName}</h2>
        <span className={`recovery-queue__chip${recovery.contactVerifiedAt ? " is-verified" : ""}`}>{t(recovery.contactVerifiedAt ? "staffRecovery.verified" : "staffRecovery.unverified")}</span>
        <span className="recovery-queue__chip is-neutral">{t(`staffRecovery.statuses.${recovery.status}`)}</span>
      </header>
      <p className="recovery-queue__hint">{t("staffRecovery.reviewHint")}</p>
      <div className="recovery-queue__cols">
        <section className="recovery-queue__panel" aria-labelledby="rq-submitted">
          <h3 id="rq-submitted">{t("staffRecovery.submitted")}</h3>
          <dl className="recovery-queue__facts">
            <Fact label={t("staffRecovery.fields.contact")}>{joinParts(recovery.contactMethod === "phone" ? recovery.contactPhone : recovery.contactEmail, recovery.phone)}</Fact>
            <Fact label={t("staffRecovery.fields.lastKnownAddress")}>{recovery.lastKnownAddress}</Fact>
            <Fact label={t("staffRecovery.fields.idLabel")}>{joinParts(recovery.idTypeDeclared, recovery.idNumberDeclared)}</Fact>
          </dl>
          <div className="recovery-queue__evidence">
            <IdEvidence key={recovery.governmentIdFile} value={recovery.governmentIdFile} label={t("staffRecovery.fields.governmentIdFile")} />
            <IdEvidence key={recovery.selfieFile} value={recovery.selfieFile} label={t("staffRecovery.fields.selfieFile")} />
          </div>
          <IdOcrSummary ocr={recovery.ocr} />
        </section>
        <section className="recovery-queue__panel" aria-labelledby="rq-onfile">
          <h3 id="rq-onfile">{t("staffRecovery.onFile")}</h3>
          {user ? <>
            <dl className="recovery-queue__facts">
              <Fact label={t("staffRecovery.fields.fullName")}>{user.name}</Fact>
              <Fact label={t("staffRecovery.fields.account")}>{joinParts(user.role, user.authProvider)}</Fact>
              <Fact label={t("staffRecovery.created")}>{formatWhen(user.createdAt)}</Fact>
              <Fact label={t("staffRecovery.lastLogin")}>{user.lastLoginAt ? formatWhen(user.lastLoginAt) : t("staffRecovery.unknown")}</Fact>
              <Fact label={t("staffRecovery.applications")}>{String(detail.totalApplications ?? 0)}</Fact>
              <Fact label={t("staffRecovery.fields.idLabel")}>{joinParts(user.governmentIdType, user.governmentIdNumber)}</Fact>
            </dl>
            <div className="recovery-queue__evidence">
              <IdEvidence key={user.validIdFile} value={user.validIdFile} label={t("staffRecovery.fields.governmentIdFile")} />
            </div>
            <IdOcrSummary ocr={user.governmentIdOcr} />
          </> : <p className="recovery-queue__nomatch">{t("staffRecovery.noAccount")}</p>}
        </section>
      </div>
      <div className="recovery-queue__table-wrap">
        <table className="admin-table"><thead><tr><th scope="col">{t("staffRecovery.field")}</th><th scope="col">{t("staffRecovery.submitted")}</th><th scope="col">{t("staffRecovery.onFile")}</th><th scope="col">{t("staffRecovery.match")}</th></tr></thead><tbody>{[["fullName", recovery.fullName, user?.name], ["dateOfBirth", recovery.dateOfBirth?.slice(0, 10), user?.dateOfBirth?.slice(0, 10)], ["idNumberDeclared", recovery.idNumberDeclared, user?.governmentIdNumber]].map(([key, submitted, onFile]) => {
          const state = submitted && onFile ? (submitted.toLowerCase() === onFile.toLowerCase() ? "yes" : "no") : "unknown";
          return <tr key={key}><th scope="row">{t(`staffRecovery.fields.${key}`)}</th><td>{submitted || "—"}</td><td>{onFile || "—"}</td><td><span className={`recovery-queue__match is-${state}`}>{t(`staffRecovery.${state}`)}</span></td></tr>;
        })}</tbody></table>
      </div>
      {recovery.status === "approved" && recovery.delivery?.status && <div className="recovery-queue__delivery">
        <p>
          <span className={`recovery-queue__chip${recovery.delivery.status === "failed" ? " is-failed" : " is-verified"}`}>{t(`staffRecovery.delivery.${recovery.delivery.status}`)}</span>{" "}
          <span className="recovery-queue__meta">{t("staffRecovery.delivery.attempts", { count: recovery.delivery.attempts || 0 })}</span>
        </p>
        {recovery.delivery.status === "failed" && !recovery.redeemedAt && <>
          <p>{t("staffRecovery.delivery.failedHint")}</p>
          <label>{t("staffRecovery.currentPassword")}<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="button" disabled={resending || !password} onClick={resend}>{resending ? t("staffRecovery.delivery.resending") : t("staffRecovery.delivery.resend")}</button>
        </>}
      </div>}
      {phoneContact && ["pending", "under_review"].includes(recovery.status) && <p>{t("staffRecovery.inPersonHint")}</p>}
      {["pending", "under_review"].includes(recovery.status) && <div className="recovery-queue__decision">
        <label className="recovery-queue__field recovery-queue__field--reason">{t("staffRecovery.reason")}<textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="recovery-queue__side">
          {phoneContact && <label className="recovery-queue__field">{t("staffRecovery.idTypeShown")}<select value={idType} onChange={(e) => setIdType(e.target.value)}><option value="">{t("staffRecovery.chooseIdType")}</option>{GOVERNMENT_ID_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
          <label className="recovery-queue__field">{t("staffRecovery.currentPassword")}<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="recovery-queue__check"><input type="checkbox" checked={matched} onChange={(e) => setMatched(e.target.checked)} /><span>{t(phoneContact ? "staffRecovery.idChecked" : "staffRecovery.identityMatched")}</span></label>
        </div>
        <div className="recovery-queue__actions">
          <button type="button" disabled={saving || !password} onClick={() => decide("under_review")}>{t("staffRecovery.review")}</button>
          <button type="button" className="is-danger" disabled={saving || !password || reason.trim().length < 10} onClick={() => decide("reject")}>{t("staffRecovery.reject")}</button>
          {phoneContact ? <button type="button" className="is-primary" disabled={saving || !password || !canCompleteInPerson} onClick={() => decide("complete_in_person")}>{t("staffRecovery.completeInPerson")}</button> : <button type="button" className="is-primary" disabled={saving || !password || !allowed || reason.trim().length < 10} onClick={() => decide("approve")}>{t("staffRecovery.approve")}</button>}
        </div>
      </div>}
    </section>}
  </div>;
}
