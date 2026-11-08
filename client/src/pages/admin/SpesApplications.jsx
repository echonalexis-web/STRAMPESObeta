import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { Eye, FileText, Download, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { spesAPI } from "../../services/api";
import SecureFileLink from "../../components/SecureFileLink";
import AppModal from "../../components/AppModal";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/feedback/context";
import { useModalA11y } from "../../hooks/useModalA11y";
import StateBlock from "../../components/StateBlock";
import { translateErrorCode } from "../../utils/apiErrors";
import {
  AMEND_OUTCOMES,
  RESULT_OUTCOMES,
  UNRESOLVED_STATUSES,
  adminTargets,
  canEvaluate,
  isOsyApplication,
  normalizeSpesStatus,
  scoreError,
} from "../../utils/spesSlots";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

// Every lifecycle status, for the queue filter.
const STATUS_FILTER_OPTIONS = [
  "submitted",
  "documents_review",
  "needs_resubmission",
  "qualified",
  "evaluated",
  "result_recorded",
  "results_released",
  "withdrawn",
  "disqualified",
];

const TIER_OPTIONS = ["minor15to17", "adult18to30", "adult31plus", "unknown"];

const GWA_SCALE_KEY = { percent: "spes.apply.scalePercent", one_to_five: "spes.apply.scaleOneToFive" };

const daysSince = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
};

// Flags applications that have gone untouched too long: only for statuses that
// still need staff action.
function AgeBadge({ app, t }) {
  if (!UNRESOLVED_STATUSES.includes(normalizeSpesStatus(app.status))) return null;
  const days = daysSince(app.createdAt);
  if (days === null || days < 7) return null;
  const tier = days >= 14 ? "danger" : "warn";
  return (
    <span className={`spes-age-badge spes-age-badge--${tier}`} title={t("spes.admin.waitingTitle", { days })}>
      {tier === "danger" ? t("spes.admin.overdue", { days }) : t("spes.admin.waiting", { days })}
    </span>
  );
}

// The applicant's name, or a visible flag when the profile has none. Never a
// bare placeholder.
const applicantLabel = (app, t) => {
  const name = String(app.applicant?.name || "").trim();
  if (name) return { text: name, missing: false };
  return { text: t(app.applicantDeleted ? "spes.admin.accountUnavailable" : "spes.admin.missingProfile"), missing: true };
};

function ApplicantName({ app, t }) {
  const label = applicantLabel(app, t);
  return (
    <div className="admin-stack-cell">
      <strong className={label.missing ? "spes-missing" : undefined}>{label.text}</strong>
      {app.applicantDeleted ? null : <span className="admin-muted">{app.applicant?.email || t("spes.admin.noEmail")}</span>}
    </div>
  );
}

function TierBadge({ tier, t }) {
  if (!tier || tier === "unknown") {
    return <span className="spes-tier spes-tier--unknown">{t("spes.admin.tier.unknown")}</span>;
  }
  return <span className={`spes-tier spes-tier--${tier}`}>{t(`spes.admin.tier.${tier}`)}</span>;
}

// ---------------------------------------------------------------------------
// Review drawer. Slides in from the right (full-screen on mobile). Uses the
// shared modal hook so the floating chatbot/messenger hide while it is open and
// the footer actions stay reachable; Escape and focus trapping come with it.
// ---------------------------------------------------------------------------
function SpesReviewDrawer({ app, released, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const drawerRef = useRef(null);
  useModalA11y(true, onClose, drawerRef);

  const status = normalizeSpesStatus(app.status);
  const [examScore, setExamScore] = useState(app.evaluation?.examScore ?? "");
  const [interviewScore, setInterviewScore] = useState(app.evaluation?.interviewScore ?? "");
  const [outcome, setOutcome] = useState(app.result?.outcome || "pending");
  const [rank, setRank] = useState(app.result?.rank ?? "");
  const [remarks, setRemarks] = useState(app.result?.remarks || "");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [docReason, setDocReason] = useState({});
  const [amendOutcome, setAmendOutcome] = useState(app.result?.outcome && app.result.outcome !== "pending" ? app.result.outcome : "accepted");
  const [amendRank, setAmendRank] = useState(app.result?.rank ?? "");
  const [amendReason, setAmendReason] = useState("");
  const [busy, setBusy] = useState("");
  const [errorCode, setErrorCode] = useState("");

  const documents = app.documents || [];
  const targets = adminTargets(status);
  const evaluating = canEvaluate(status);
  // A disqualified or withdrawn applicant has nothing left to score or decide.
  const excluded = status === "disqualified" || status === "withdrawn";
  const isDisqualify = target === "disqualified";
  const examErr = scoreError(examScore);
  const interviewErr = scoreError(interviewScore);

  const run = async (key, action, successKey) => {
    setBusy(key);
    setErrorCode("");
    try {
      const { data } = await action();
      onSaved(data?.application);
      toast.success(t(successKey));
      return true;
    } catch (err) {
      const code = err?.response?.data?.code;
      setErrorCode(code || "GENERIC");
      toast.error(translateErrorCode(code, err?.response?.data?.message || t("spes.admin.saveFailed")));
      return false;
    } finally {
      setBusy("");
    }
  };

  const verifyDoc = (doc, state) => {
    const why = (docReason[doc._id] || "").trim();
    if (state === "needs_replacement" && !why) {
      setErrorCode("SPES_REASON_REQUIRED");
      return;
    }
    run(`doc-${doc._id}`, () => spesAPI.adminVerifyDocument(app._id, doc._id, { state, reason: why }), "spes.admin.docSaved");
  };

  const changeStatus = async () => {
    if (!target) return;
    if (isDisqualify && !reason.trim()) {
      setErrorCode("SPES_REASON_REQUIRED");
      return;
    }
    const ok = await run("status", () => spesAPI.adminRecordEvaluation(app._id, { status: target, remarks: reason }), "spes.admin.statusSaved");
    if (ok) {
      setTarget("");
      setReason("");
    }
  };

  const saveEvaluation = () => {
    if (examErr || interviewErr) {
      setErrorCode("SPES_SCORE_INVALID");
      return;
    }
    run(
      "eval",
      () => spesAPI.adminRecordEvaluation(app._id, { examScore, interviewScore, outcome, rank, remarks }),
      "spes.admin.evalSaved"
    );
  };

  const amend = async () => {
    if (!amendReason.trim()) {
      setErrorCode("SPES_REASON_REQUIRED");
      return;
    }
    const ok = await run("amend", () => spesAPI.adminAmendResult(app._id, { outcome: amendOutcome, rank: amendRank, remarks: amendReason }), "spes.admin.amended");
    if (ok) setAmendReason("");
  };

  const gwaText = app.gwa !== null && app.gwa !== undefined && app.gwa !== ""
    ? `${app.gwa}${app.gwaScale ? ` (${t(GWA_SCALE_KEY[app.gwaScale] || "spes.apply.scalePercent")})` : ""}`
    : "—";

  return (
    <div className="spes-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="spes-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("spes.admin.drawerTitle")}
        ref={drawerRef}
        tabIndex={-1}
      >
        <div className="spes-drawer__header">
          <div>
            <h2>{applicantLabel(app, t).text}</h2>
            <p className="spes-drawer__subtitle">
              {app.applicantDeleted ? null : <>{app.applicant?.email || t("spes.admin.noEmail")} · </>}
              {app.announcement?.title || t("spes.my.programFallback")}
            </p>
          </div>
          <button type="button" className="spes-drawer__close" onClick={onClose} aria-label={t("common.close", { defaultValue: "Close" })}>
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="spes-drawer__body">
          <section className="spes-drawer__section">
            <h3>{t("spes.admin.applicantInfo")}</h3>
            <div className="spes-drawer__facts">
              <span><TierBadge tier={app.applicantAgeTier} t={t} /></span>
              <span className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)}</span>
              <span className="spes-chip spes-chip--osy">{isOsyApplication(app) ? t("spes.apply.typeOsy") : t("spes.apply.typeStudent")}</span>
            </div>
            {app.applicantAgeTier === "minor15to17" ? (
              <p className="spes-drawer__warning">{t("spes.admin.minorReminder")}</p>
            ) : null}
            <dl className="spes-drawer__dl">
              <dt>{t("spes.apply.contact")}</dt>
              <dd>{app.contactNumber || "—"}</dd>
              {!isOsyApplication(app) ? (
                <>
                  <dt>{t("spes.apply.school")}</dt>
                  <dd>{[app.school, app.gradeLevel].filter(Boolean).join(", ") || "—"}</dd>
                  <dt>{t("spes.apply.gwa")}</dt>
                  <dd>{gwaText}</dd>
                </>
              ) : null}
              {app.guardianName ? (
                <>
                  <dt>{t("spes.admin.guardian")}</dt>
                  <dd>{app.guardianName}{app.guardianContact ? ` · ${app.guardianContact}` : ""}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="spes-drawer__section">
            <h3>{t("spes.admin.documentsTitle")}</h3>
            {documents.length === 0 ? (
              <p className="spes-note">{t("spes.admin.noDocuments")}</p>
            ) : (
              <div className="spes-doc-review">
                {documents.map((doc, i) => {
                  const state = doc.verification?.state || "pending";
                  const locked = released || ["withdrawn", "disqualified"].includes(status);
                  return (
                    <div className={`spes-doc-review__item spes-doc-review__item--${state}`} key={doc._id || i}>
                      <div className="spes-doc-review__head">
                        <FileText size={18} className="spes-doc-card__icon" aria-hidden="true" />
                        <div className="spes-doc-review__name">
                          <strong>{doc.slot ? t(`spes.docs.slot.${doc.slot}`) : t("spes.docs.untyped")}</strong>
                          <span className="admin-muted">{doc.label}</span>
                        </div>
                        <SecureFileLink className="spes-doc-card__link" value={doc.fileUrl}>
                          <Download size={14} aria-hidden="true" /> {t("spes.docs.view")}
                        </SecureFileLink>
                      </div>
                      {/* "Waiting for review" is only true while review can still happen. */}
                      {locked && state === "pending" ? null : (
                        <p className="spes-doc-review__state">
                          {state === "verified" ? <CheckCircle2 size={14} aria-hidden="true" /> : state === "needs_replacement" ? <AlertTriangle size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}{" "}
                          {t(`spes.docs.state.${state}`)}
                          {state === "needs_replacement" && doc.verification?.reason ? ` — ${doc.verification.reason}` : ""}
                        </p>
                      )}
                      {!locked && doc._id ? (
                        <div className="spes-doc-review__actions">
                          <input
                            type="text"
                            className="spes-doc-review__reason"
                            placeholder={t("spes.admin.replaceReasonPlaceholder")}
                            aria-label={t("spes.admin.replaceReasonLabel")}
                            value={docReason[doc._id] || ""}
                            onChange={(e) => setDocReason((prev) => ({ ...prev, [doc._id]: e.target.value }))}
                          />
                          <button type="button" className="spes-btn spes-btn--small" disabled={busy === `doc-${doc._id}` || state === "verified"} onClick={() => verifyDoc(doc, "verified")}>
                            {t("spes.admin.verify")}
                          </button>
                          <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" disabled={busy === `doc-${doc._id}`} onClick={() => verifyDoc(doc, "needs_replacement")}>
                            {t("spes.admin.needsReplacement")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {!released && targets.length > 0 ? (
            <section className="spes-drawer__section">
              <h3>{t("spes.admin.statusTitle")}</h3>
              <p className="spes-note">{t("spes.admin.statusCurrent", { status: t(`spes.status.${status}`) })}</p>
              <label className="spes-drawer__field">
                {t("spes.admin.moveTo")}
                <select value={target} onChange={(e) => { setTarget(e.target.value); setErrorCode(""); }}>
                  <option value="">{t("spes.admin.noChange")}</option>
                  {targets.map((s) => (
                    <option key={s} value={s}>{t(`spes.status.${s}`)}</option>
                  ))}
                </select>
              </label>
              {target ? (
                <label className="spes-drawer__field">
                  {isDisqualify ? t("spes.admin.disqualifyReason") : t("spes.admin.noteOptional")}
                  <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              ) : null}
              {isDisqualify ? <p className="spes-drawer__warning">{t("spes.admin.disqualifyWarning")}</p> : null}
              <button type="button" className="spes-btn" disabled={!target || busy === "status"} onClick={changeStatus}>
                {busy === "status" ? t("spes.admin.saving") : t("spes.admin.applyStatus")}
              </button>
            </section>
          ) : null}

          {excluded ? (
            <section className="spes-drawer__section">
              <p className="spes-note">{t("spes.admin.excludedNote", { status: t(`spes.status.${status}`) })}</p>
            </section>
          ) : !released ? (
            <section className="spes-drawer__section">
              <h3>{t("spes.admin.scoringTitle")}</h3>
              {!evaluating ? <p className="spes-note">{t("spes.admin.evaluateLocked")}</p> : null}
              <div className="spes-drawer__grid">
                <label>
                  {t("spes.admin.examScore")}
                  <input type="number" min="0" max="100" step="0.01" inputMode="decimal" disabled={!evaluating} value={examScore} onChange={(e) => setExamScore(e.target.value)} aria-invalid={Boolean(examErr)} />
                </label>
                <label>
                  {t("spes.admin.interviewScore")}
                  <input type="number" min="0" max="100" step="0.01" inputMode="decimal" disabled={!evaluating} value={interviewScore} onChange={(e) => setInterviewScore(e.target.value)} aria-invalid={Boolean(interviewErr)} />
                </label>
                <label>
                  {t("spes.admin.result")}
                  <select value={outcome} disabled={!evaluating} onChange={(e) => setOutcome(e.target.value)}>
                    {RESULT_OUTCOMES.map((o) => (
                      <option key={o} value={o}>{t(`spes.outcome.${o}`)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("spes.admin.rank")}
                  <input type="number" min="1" step="1" inputMode="numeric" disabled={!evaluating || outcome === "pending" || outcome === "not_accepted"} value={rank} onChange={(e) => setRank(e.target.value)} />
                </label>
              </div>
              <label className="spes-drawer__field">
                {t("spes.admin.resultRemarks")}
                <textarea rows={3} disabled={!evaluating} placeholder={t("spes.admin.resultRemarksPlaceholder")} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>
            </section>
          ) : (
            <section className="spes-drawer__section">
              <h3>{t("spes.admin.amendTitle")}</h3>
              <p className="spes-note">{t("spes.admin.amendHint")}</p>
              <div className="spes-drawer__grid">
                <label>
                  {t("spes.admin.result")}
                  <select value={amendOutcome} onChange={(e) => setAmendOutcome(e.target.value)}>
                    {AMEND_OUTCOMES.map((o) => (
                      <option key={o} value={o}>{t(`spes.outcome.${o}`)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("spes.admin.rank")}
                  <input type="number" min="1" step="1" inputMode="numeric" disabled={amendOutcome === "not_accepted"} value={amendRank} onChange={(e) => setAmendRank(e.target.value)} />
                </label>
              </div>
              <label className="spes-drawer__field">
                {t("spes.admin.amendReason")}
                <textarea rows={3} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
              </label>
              <button type="button" className="spes-btn" disabled={busy === "amend"} onClick={amend}>
                {busy === "amend" ? t("spes.admin.saving") : t("spes.admin.amendButton")}
              </button>
            </section>
          )}

          {errorCode ? (
            <p className="spes-drawer__error" role="alert">
              {translateErrorCode(errorCode, t("spes.admin.saveFailed"))}
            </p>
          ) : null}
        </div>

        <div className="spes-drawer__actions">
          <button type="button" className="spes-btn spes-btn--ghost" onClick={onClose} disabled={Boolean(busy)}>
            {t("spes.admin.close")}
          </button>
          {!released && !excluded ? (
            <button type="button" className="spes-btn" onClick={saveEvaluation} disabled={!evaluating || busy === "eval" || Boolean(examErr || interviewErr)}>
              {busy === "eval" ? t("spes.admin.saving") : t("spes.admin.saveEvaluation")}
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

// Release confirmation: shows exactly what will happen before it does.
function ReleaseDialog({ program, onClose, onReleased }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await spesAPI.adminReleaseSummary(program._id);
        if (active) setSummary(data);
      } catch (err) {
        toast.error(translateErrorCode(err?.response?.data?.code, t("spes.admin.saveFailed")));
        onClose();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program._id]);

  const release = async () => {
    setReleasing(true);
    try {
      await spesAPI.adminReleaseResults(program._id);
      toast.success(t("spes.admin.released"));
      onReleased(program._id);
      onClose();
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, err?.response?.data?.message || t("spes.admin.saveFailed")));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <AppModal isOpen onClose={onClose} title={t("spes.admin.releaseTitle", { title: program.title })} closeLabel={t("common.close", { defaultValue: "Close" })}>
      {loading || !summary ? (
        <p className="spes-note">{t("admin.spes.loading")}</p>
      ) : (
        <div className="spes-release">
          <p className="spes-note">{t("spes.admin.releaseIntro", { count: summary.toNotify })}</p>
          <ul className="spes-release__list">
            <li>{t("spes.outcome.accepted")}: <strong>{summary.byOutcome.accepted}</strong></li>
            <li>{t("spes.outcome.waitlisted")}: <strong>{summary.byOutcome.waitlisted}</strong></li>
            <li>{t("spes.outcome.not_accepted")}: <strong>{summary.byOutcome.not_accepted}</strong></li>
            <li>{t("spes.admin.excludedCount")}: <strong>{summary.excluded}</strong></li>
          </ul>
          {summary.undecided > 0 ? (
            <p className="spes-drawer__error" role="alert">{t("spes.admin.undecidedBlock", { count: summary.undecided })}</p>
          ) : (
            <p className="spes-drawer__warning">{t("spes.admin.releaseWarning")}</p>
          )}
          <div className="spes-modal__actions">
            <button type="button" className="spes-btn spes-btn--ghost" onClick={onClose} disabled={releasing}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button type="button" className="spes-btn" disabled={!summary.canRelease || releasing} onClick={release}>
              {releasing ? t("spes.admin.releasing") : t("spes.admin.releaseConfirm")}
            </button>
          </div>
        </div>
      )}
    </AppModal>
  );
}

export default function SpesApplications() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [programs, setPrograms] = useState([]);
  const [announcementId, setAnnouncementId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [releaseFor, setReleaseFor] = useState(null);

  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString(i18n.language?.startsWith("fil") ? "fil-PH" : "en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const loadPrograms = useCallback(async () => {
    try {
      const { data } = await spesAPI.adminPrograms();
      setPrograms(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setPrograms([]);
    }
  }, []);

  useEffect(() => {
    loadPrograms();
  }, [loadPrograms]);

  // The school filter waits for a pause in typing before querying.
  useEffect(() => {
    const id = setTimeout(() => setSchoolFilter(schoolQuery.trim()), 350);
    return () => clearTimeout(id);
  }, [schoolQuery]);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await spesAPI.adminList({
        announcement: announcementId || undefined,
        status: statusFilter || undefined,
        applicantType: typeFilter || undefined,
        ageTier: tierFilter || undefined,
        school: schoolFilter || undefined,
        limit: 200,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setLoadError(true);
      toast.error(translateErrorCode(err?.response?.data?.code, err?.response?.data?.message || t("spes.admin.loadFailed")));
      setItems([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcementId, statusFilter, typeFilter, tierFilter, schoolFilter]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const selectedProgram = useMemo(() => programs.find((p) => p._id === announcementId) || null, [programs, announcementId]);
  const reviewingReleased = reviewing
    ? Boolean(reviewing.resultReleasedAt) || normalizeSpesStatus(reviewing.status) === "results_released" ||
      programs.find((p) => p._id === (reviewing.announcement?._id || reviewing.announcement))?.resultsStatus === "published"
    : false;

  const toggleClosed = async (program) => {
    try {
      await spesAPI.adminSetProgramClosed(program._id, program.open);
      toast.success(t(program.open ? "spes.admin.closedToast" : "spes.admin.reopenedToast"));
      loadPrograms();
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, t("spes.admin.saveFailed")));
    }
  };

  // Every PATCH returns the populated application, so merge it over the row
  // and the open drawer.
  const patchItem = (updated) => {
    if (!updated) return;
    setItems((prev) => prev.map((a) => (a._id === updated._id ? { ...a, ...updated } : a)));
    setReviewing((prev) => (prev && prev._id === updated._id ? { ...prev, ...updated } : prev));
    loadPrograms();
  };

  const statusCounts = (program) => {
    const by = program.counts?.byStatus || {};
    return ["submitted", "documents_review", "needs_resubmission", "qualified", "evaluated", "result_recorded", "results_released"]
      .filter((s) => by[s])
      .map((s) => ({ status: s, n: by[s] }));
  };

  return (
    <div className="admin-page-container spes-admin">
      <AdminHeader title={t("spes.admin.pageTitle")} description={t("spes.admin.pageDescription")} />

      <section className="spes-programs" aria-labelledby="spes-programs-title">
        <h2 id="spes-programs-title" className="spes-admin__title spes-programs__title">{t("spes.admin.programsTitle")}</h2>
        {programs.length === 0 ? (
          <p className="spes-note spes-programs__empty">{t("spes.admin.noPrograms")}</p>
        ) : (
          <div className="spes-programs__grid">
            {programs.map((program) => {
              const released = program.resultsStatus === "published";
              const selected = announcementId === program._id;
              return (
                <article key={program._id} className={`spes-program-card${selected ? " is-selected" : ""}`}>
                  <div className="spes-program-card__head">
                    <h3>{program.title}</h3>
                    <span className={`spes-chip ${released ? "spes-chip--results_released" : program.open ? "" : "spes-chip--closed"}`}>
                      {released ? t("spes.admin.resultsPublished") : program.open ? t("spes.admin.open") : t("spes.admin.closed")}
                    </span>
                  </div>
                  <p className="spes-card__meta">
                    {program.applicationDeadline ? t("spes.panel.deadline", { date: formatDate(program.applicationDeadline) }) : t("spes.admin.noDeadline")}
                    {" · "}
                    {t("spes.admin.applicantCount", { count: program.counts?.total || 0 })}
                  </p>
                  {!released && !program.open && program.closedReason ? (
                    <p className="spes-program-card__reason">{t(`spes.admin.closedReason.${program.closedReason}`)}</p>
                  ) : null}
                  <div className="spes-program-card__counts">
                    {statusCounts(program).map(({ status, n }) => (
                      <span key={status} className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)} · {n}</span>
                    ))}
                  </div>
                  <div className="spes-program-card__actions">
                    <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => setAnnouncementId(selected ? "" : program._id)} aria-pressed={selected}>
                      {selected ? t("spes.admin.showAll") : t("spes.admin.filterThis")}
                    </button>
                    {!released ? (
                      <>
                        <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => toggleClosed(program)}>
                          {program.open ? t("spes.admin.closeApplications") : t("spes.admin.reopenApplications")}
                        </button>
                        <button type="button" className="spes-btn spes-btn--small spes-program-card__release" onClick={() => setReleaseFor(program)} disabled={!program.counts?.total}>
                          {t("spes.admin.release")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="spes-admin-controls ds-toolbar">
        <label>
          {t("spes.admin.filterProgram")}
          <select value={announcementId} onChange={(e) => setAnnouncementId(e.target.value)}>
            <option value="">{t("spes.admin.allPrograms")}</option>
            {programs.map((p) => (
              <option key={p._id} value={p._id}>{p.title}</option>
            ))}
          </select>
        </label>
        <label>
          {t("spes.admin.filterStatus")}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t("spes.admin.anyStatus")}</option>
            {STATUS_FILTER_OPTIONS.map((s) => (
              <option key={s} value={s}>{t(`spes.status.${s}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("spes.admin.filterType")}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">{t("spes.admin.anyType")}</option>
            <option value="student">{t("spes.apply.typeStudent")}</option>
            <option value="osy">{t("spes.apply.typeOsy")}</option>
          </select>
        </label>
        <label>
          {t("spes.admin.filterAge")}
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="">{t("spes.admin.anyAge")}</option>
            {TIER_OPTIONS.map((tier) => (
              <option key={tier} value={tier}>{t(`spes.admin.tier.${tier}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("spes.admin.filterSchool")}
          <input type="search" value={schoolQuery} onChange={(e) => setSchoolQuery(e.target.value)} placeholder={t("spes.admin.schoolPlaceholder")} />
        </label>
      </div>

      {selectedProgram && selectedProgram.resultsStatus !== "published" ? (
        <p className="spes-release-bar">{t("spes.admin.releaseBar")}</p>
      ) : null}

      <div className="admin-panel-card">
        <div className="admin-card-header">
          <h2 className="spes-admin__title">{t("spes.admin.queueTitle")}</h2>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("spes.admin.colApplicant")}</th>
                <th>{t("spes.admin.colAge")}</th>
                <th>{t("spes.admin.colSchool")}</th>
                <th>{t("spes.admin.colSubmitted")}</th>
                <th>{t("spes.admin.colStatus")}</th>
                <th>{t("spes.admin.colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="spes-admin__state-cell">
                    <StateBlock kind="loading" title={t("admin.spes.loading")} />
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} className="spes-admin__state-cell">
                    <StateBlock
                      kind="error"
                      title={t("spes.admin.loadFailed")}
                      action={<button type="button" className="spes-btn spes-btn--small" onClick={loadApplications}>{t("spes.admin.retry")}</button>}
                    />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="spes-admin__state-cell">
                    <StateBlock kind="empty" title={t("admin.spes.emptyTitle")} description={t("admin.spes.emptyDescription")} />
                  </td>
                </tr>
              ) : (
                items.map((app) => {
                  const status = normalizeSpesStatus(app.status);
                  return (
                    <tr key={app._id}>
                      <td><ApplicantName app={app} t={t} /></td>
                      <td><TierBadge tier={app.applicantAgeTier} t={t} /></td>
                      <td>
                        {isOsyApplication(app) ? (
                          <span className="spes-chip spes-chip--osy">{t("spes.apply.typeOsy")}</span>
                        ) : (
                          <div className="admin-stack-cell">
                            <span>{app.school || "—"}</span>
                            {app.gradeLevel ? <span className="admin-muted">{app.gradeLevel}</span> : null}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="spes-submitted-date">
                          <Clock size={13} aria-hidden="true" /> {formatDate(app.createdAt)}
                        </span>
                        <AgeBadge app={app} t={t} />
                      </td>
                      <td><span className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)}</span></td>
                      <td>
                        <button type="button" className="admin-inline-btn" onClick={() => setReviewing(app)}>
                          <Eye size={16} aria-hidden="true" /> {t("spes.admin.review")}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reviewing ? (
        <SpesReviewDrawer app={reviewing} released={reviewingReleased} onClose={() => setReviewing(null)} onSaved={patchItem} />
      ) : null}
      {releaseFor ? (
        <ReleaseDialog
          program={releaseFor}
          onClose={() => setReleaseFor(null)}
          onReleased={() => {
            loadPrograms();
            loadApplications();
          }}
        />
      ) : null}
    </div>
  );
}
