import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { spesAPI } from "../services/api";
import StateBlock from "../components/StateBlock";
import { translateErrorCode } from "../utils/apiErrors";
import { POSTING_TABS, formatSpesDate, matchesTab } from "../utils/spesPostings";
import { normalizeSpesStatus } from "../utils/spesSlots";
import "../styles/spes.css";

// Applicant list of SPES postings. 15-17 users apply from here; users aged 31 and
// older can read the postings but not apply (the server enforces both).
export default function SpesPostings() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState([]);
  const [ageTier, setAgeTier] = useState("unknown");
  const [tab, setTab] = useState("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await spesAPI.listPostings();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setAgeTier(data?.ageTier || "unknown");
    } catch (err) {
      setError(translateErrorCode(err?.response?.data?.code, t("spesPostings.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => items.filter((item) => matchesTab(tab, item.posting)), [items, tab]);

  return (
    <main className="spes-page">
      <div className="spes-page__banner">
        <div>
          <h1>{t("spesPostings.title")}</h1>
          <p className="spes-note">{t("spesPostings.subtitle")}</p>
        </div>
        <Link to="/spes/applications" className="spes-btn spes-btn--ghost">
          {t("navbar.mySpesApplications")}
        </Link>
      </div>

      {ageTier === "minor15to17" ? (
        <p className="spes-notice spes-notice--info" role="note">{t("spesPostings.noticeMinor")}</p>
      ) : null}
      {ageTier === "adult31plus" ? (
        <p className="spes-notice spes-notice--info" role="note">{t("spesPostings.noticeSenior")}</p>
      ) : null}

      <div className="spes-tabs" role="tablist" aria-label={t("spesPostings.tabsLabel")}>
        {POSTING_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`spes-tab${tab === key ? " is-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {t(`spesPostings.tab.${key}`)}
          </button>
        ))}
      </div>

      {loading ? <StateBlock kind="loading" title={t("spesPostings.loading")} /> : null}
      {!loading && error ? (
        <StateBlock
          kind="error"
          title={t("spesPostings.errorTitle")}
          description={error}
          action={
            <button type="button" className="spes-btn spes-btn--small" onClick={load}>
              {t("spes.admin.retry")}
            </button>
          }
        />
      ) : null}
      {!loading && !error && visible.length === 0 ? (
        <StateBlock
          kind="empty"
          title={items.length === 0 ? t("spesPostings.emptyTitle") : t("spesPostings.emptyTabTitle")}
          description={items.length === 0 ? t("spesPostings.emptyBody") : t("spesPostings.emptyTabBody")}
        />
      ) : null}

      {!loading && !error && visible.length > 0 ? (
        <ul className="spes-postings">
          {visible.map((item) => {
            const { posting, myApplication, canApply, readOnly } = item;
            const status = posting.displayStatus;
            return (
              <li key={posting._id} className="spes-posting-card">
                <div className="spes-posting-card__head">
                  <h2>
                    <Link to={`/spes/postings/${posting._id}`}>{posting.title}</Link>
                  </h2>
                  <span className={`spes-chip spes-chip--posting-${status}`}>{t(`spesPostings.status.${status}`)}</span>
                </div>
                <p className="spes-card__meta">
                  {posting.applicationDeadline
                    ? t("spes.panel.deadline", { date: formatSpesDate(posting.applicationDeadline, i18n.language) })
                    : t("spes.admin.noDeadline")}
                  {posting.slots ? ` · ${t("spes.panel.slots", { count: Number(posting.slots) })}` : ""}
                </p>
                {posting.description ? <p className="spes-posting-card__text">{posting.description}</p> : null}
                {myApplication ? (
                  <p className="spes-posting-card__mine">
                    {t("spesPostings.yourApplication")}{" "}
                    <span className={`spes-chip spes-chip--${normalizeSpesStatus(myApplication.status)}`}>
                      {t(`spes.status.${normalizeSpesStatus(myApplication.status)}`)}
                    </span>
                  </p>
                ) : readOnly ? (
                  <p className="spes-note">{t("spesPostings.readOnlyShort")}</p>
                ) : null}
                <div className="spes-posting-card__actions">
                  {myApplication ? (
                    <Link to="/spes/applications" className="spes-btn spes-btn--small">
                      {t("spesPostings.viewApplication")}
                    </Link>
                  ) : (
                    <Link
                      to={`/spes/postings/${posting._id}`}
                      className={`spes-btn spes-btn--small${canApply ? "" : " spes-btn--ghost"}`}
                    >
                      {canApply ? t("spesPostings.viewAndApply") : t("spesPostings.viewPosting")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}
