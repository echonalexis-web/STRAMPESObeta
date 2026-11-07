import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CircleCheck,
  ClipboardCheck,
  Frown,
  Info,
  Lock,
  Mail,
  Send,
  ShieldCheck,
} from "lucide-react";
import { appealAPI } from "../services/api";
import "../styles/suspended.css";
import { SUPPORT_EMAIL } from "../components/AccountInactiveModal";

const APPEAL_MAX_LENGTH = 2000;
const APPEAL_MIN_LENGTH = 10;
// Announce the remaining-character count to assistive tech only when the
// limit is close, instead of on every keystroke.
const COUNTER_ANNOUNCE_AT = 100;

const readSuspensionInfo = () => {
  try {
    return JSON.parse(localStorage.getItem("suspensionInfo") || "{}");
  } catch {
    return {};
  }
};

const formatDate = (value, language) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(language === "fil" ? "fil-PH" : [], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const APPEAL_STATUS_TONE = {
  pending: "pending",
  under_review: "pending",
  approved: "approved",
  denied: "denied",
};

const APPEAL_STATUS_KEY = {
  pending: "pending",
  under_review: "underReview",
  approved: "approved",
  denied: "denied",
};

export default function AccountSuspended() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState(readSuspensionInfo);
  const [appeal, setAppeal] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const submittingRef = useRef(false);

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
            setNotice(t("accountSuspended.restoredNotice"));
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
    // `t` is intentionally left out: the effect fetches once per appeal
    // session, and a language switch must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAppealSession]);

  const isBanned = info.accountStatus === "banned";
  const suspendedOn = useMemo(
    () => formatDate(info.suspendedAt, i18n.language),
    [info.suspendedAt, i18n.language]
  );

  const openAppeal =
    appeal && (appeal.status === "pending" || appeal.status === "under_review");
  const accountRestored = info.accountStatus === "active";
  const trimmedLength = message.trim().length;
  const remaining = APPEAL_MAX_LENGTH - message.length;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");

    const trimmed = message.trim();
    if (trimmed.length < APPEAL_MIN_LENGTH) {
      setError(t("accountSuspended.errorTooShort"));
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { data } = await appealAPI.submit(trimmed);
      setAppeal(data.appeal || null);
      setMessage("");
      setJustSubmitted(true);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.appeal) setAppeal(data.appeal);
      setError(data?.message || t("accountSuspended.errorSubmitFailed"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    localStorage.removeItem("appealToken");
    localStorage.removeItem("suspensionInfo");
    navigate("/login");
  };

  const statusKey = appeal ? APPEAL_STATUS_KEY[appeal.status] : null;
  const showForm = hasAppealSession && !loading && !accountRestored && !openAppeal;
  const errorId = "appeal-error";
  const counterId = "appeal-counter";

  const renderAppealBody = () => {
    if (!hasAppealSession) {
      return <p className="suspended-hint">{t("accountSuspended.loginAgainHint")}</p>;
    }
    if (loading) {
      return <p className="suspended-hint">{t("accountSuspended.checking")}</p>;
    }
    if (accountRestored) {
      return (
        <button type="button" className="suspended-primary" onClick={backToLogin}>
          {t("accountSuspended.goToLogin")}
        </button>
      );
    }

    return (
      <>
        {justSubmitted && openAppeal ? (
          <div className="suspended-success" role="status">
            <CircleCheck aria-hidden="true" />
            <div>
              <h3>{t("accountSuspended.successTitle")}</h3>
              <p>{t("accountSuspended.successBody")}</p>
            </div>
          </div>
        ) : null}

        {appeal && !(justSubmitted && openAppeal) ? (
          <div
            className={`suspended-appeal-status ${APPEAL_STATUS_TONE[appeal.status] || ""}`}
          >
            <span className="suspended-status-pill">
              {statusKey
                ? t(`accountSuspended.status.${statusKey}`)
                : appeal.status}
            </span>
            <p className="suspended-submitted-on">
              {t("accountSuspended.submittedOn", {
                date:
                  formatDate(appeal.createdAt, i18n.language) ||
                  t("accountSuspended.submittedRecently"),
              })}
            </p>
            {appeal.adminResponse ? (
              <p className="suspended-admin-response">
                <strong>{t("accountSuspended.adminResponseLabel")}</strong>{" "}
                {appeal.adminResponse}
              </p>
            ) : null}
          </div>
        ) : null}

        {openAppeal && !justSubmitted ? (
          <p className="suspended-hint">{t("accountSuspended.queueHint")}</p>
        ) : null}

        {!showForm && error ? (
          <div className="suspended-alert" role="alert">
            {error}
          </div>
        ) : null}

        {showForm ? (
          <form onSubmit={handleSubmit} className="suspended-form" noValidate>
            {appeal?.status === "denied" ? (
              <p className="suspended-hint suspended-hint--lead">
                {t("accountSuspended.appealDeniedIntro")}
              </p>
            ) : null}
            <label htmlFor="appeal-message">
              {t("accountSuspended.appealLabel")}{" "}
              <span aria-hidden="true" className="suspended-required">
                *
              </span>
            </label>
            <textarea
              id="appeal-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError("");
              }}
              placeholder={t("accountSuspended.appealPlaceholder")}
              maxLength={APPEAL_MAX_LENGTH}
              disabled={submitting}
              required
              aria-required="true"
              aria-invalid={error ? "true" : "false"}
              aria-describedby={error ? `${counterId} ${errorId}` : counterId}
              className={error ? "has-error" : ""}
            />
            <div className="suspended-form-foot">
              <span>{t("accountSuspended.requiredNote")}</span>
              <span id={counterId} aria-hidden="true">
                {t("accountSuspended.counter", {
                  count: message.length,
                  max: APPEAL_MAX_LENGTH,
                })}
              </span>
            </div>
            <span className="ds-sr-only" aria-live="polite">
              {remaining <= COUNTER_ANNOUNCE_AT
                ? t("accountSuspended.counterRemaining", { count: remaining })
                : ""}
            </span>
            {error ? (
              <div className="suspended-alert" role="alert" id={errorId}>
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              className="suspended-primary suspended-primary--block"
              disabled={submitting || trimmedLength === 0}
              aria-busy={submitting}
            >
              {submitting ? (
                <span className="suspended-spinner" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {submitting
                ? t("accountSuspended.submitting")
                : t("accountSuspended.submit")}
            </button>
            <p className="suspended-privacy">
              <Lock aria-hidden="true" />
              {t("accountSuspended.appealPrivacyNote")}
            </p>
          </form>
        ) : null}
      </>
    );
  };

  return (
    <div className="suspended-page">
      <main className="suspended-main">
        <button
          type="button"
          className="suspended-back suspended-back--top"
          onClick={backToLogin}
        >
          <ArrowLeft aria-hidden="true" />
          {t("accountSuspended.backToLogin")}
        </button>

        <div className="suspended-grid">
          <section className="suspended-intro" aria-labelledby="suspended-title">
            <div className={`suspended-badge ${isBanned ? "banned" : ""}`} aria-hidden="true">
              <Frown />
            </div>
            <h1 id="suspended-title">
              {isBanned
                ? t("accountSuspended.titleBanned")
                : t("accountSuspended.titleSuspended")}
            </h1>
            <p className="suspended-lead">
              {isBanned
                ? t("accountSuspended.leadBanned")
                : t("accountSuspended.leadSuspended")}
            </p>

            <div className="suspended-note">
              <Info aria-hidden="true" />
              <p>{t("accountSuspended.infoNote")}</p>
            </div>

            <section className="suspended-details" aria-labelledby="suspended-details-title">
              <h2 id="suspended-details-title">
                <ClipboardCheck aria-hidden="true" />
                {t("accountSuspended.detailsTitle")}
              </h2>
              <p className="suspended-details__label">{t("accountSuspended.reasonLabel")}</p>
              <p className="suspended-details__reason">
                {info.suspensionReason || t("accountSuspended.reasonFallback")}
              </p>
              <dl className="suspended-meta">
                <div className="suspended-meta-row">
                  <dt>{t("accountSuspended.dateLabel")}</dt>
                  <dd>{suspendedOn || t("accountSuspended.dateFallback")}</dd>
                </div>
                <div className="suspended-meta-row">
                  <dt>{t("accountSuspended.durationLabel")}</dt>
                  <dd>
                    {isBanned
                      ? t("accountSuspended.durationBanned")
                      : t("accountSuspended.durationSuspended")}
                  </dd>
                </div>
                <div className="suspended-meta-row">
                  <dt>{t("accountSuspended.administratorLabel")}</dt>
                  <dd>{t("accountSuspended.administratorValue")}</dd>
                </div>
              </dl>
            </section>
          </section>

          <section className="suspended-next" aria-labelledby="suspended-next-title">
            <p className="suspended-next__eyebrow">{t("accountSuspended.nextStepsEyebrow")}</p>
            <h2 id="suspended-next-title" className="suspended-next__title">
              {t("accountSuspended.nextStepsTitle")}
            </h2>
            <p className="suspended-next__lead">{t("accountSuspended.nextStepsLead")}</p>

            <div className="suspended-support">
              <p className="suspended-support__title">
                <Mail aria-hidden="true" />
                {t("accountSuspended.supportTitle")}
              </p>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </div>

            <div className="suspended-appeal">
              <div className="suspended-appeal-head">
                <h3>
                  <ShieldCheck aria-hidden="true" />
                  {t("accountSuspended.appealTitle")}
                </h3>
                <p>{t("accountSuspended.appealIntro")}</p>
              </div>

              {notice ? (
                <div className="suspended-notice success" role="status">
                  {notice}
                </div>
              ) : null}

              {renderAppealBody()}
            </div>
          </section>
        </div>

        <button
          type="button"
          className="suspended-back suspended-back--bottom"
          onClick={backToLogin}
        >
          <ArrowLeft aria-hidden="true" />
          {t("accountSuspended.backToLogin")}
        </button>
      </main>

      <footer className="suspended-footer">
        <p>{t("accountSuspended.copyright", { year: new Date().getFullYear() })}</p>
        <p className="suspended-footer__secure">
          <Lock aria-hidden="true" />
          {t("accountSuspended.secureServices")}
        </p>
      </footer>
    </div>
  );
}
