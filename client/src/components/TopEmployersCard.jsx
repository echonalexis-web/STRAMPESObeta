import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import Avatar from "./Avatar";
import StateBlock from "./StateBlock";
import { manilaToday } from "../utils/analyticsFilterParams";
import "../styles/analytics-filters.css";

// Top 5 employers of the current quarter for the admin dashboard, with a link to the full view.
export default function TopEmployersCard() {
  const { t } = useTranslation();
  const params = useMemo(() => {
    const today = manilaToday();
    return { period: "quarter", year: String(today.year), quarter: String(Math.floor((today.month - 1) / 3) + 1), limit: "5" };
  }, []);
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${JSON.stringify(params)}#${attempt}`;

  useEffect(() => {
    let live = true;
    adminAPI
      .getEmployerPerformance(params)
      .then(({ data }) => live && setLoaded({ key: requestKey, data }))
      .catch(() => live && setFailedKey(requestKey));
    return () => {
      live = false;
    };
  }, [params, requestKey]);

  // "Loading" is derived from which request the answer belongs to (no setState in the effect).
  const status = failedKey === requestKey ? "error" : loaded?.key === requestKey ? "ready" : "loading";
  const rows = loaded?.data?.rows || [];

  return (
    <article className="asf__panel epf-top" aria-labelledby="epf-top-title">
      <div className="epf-top__head">
        <h2 id="epf-top-title" className="asf__panel-title">{t("analyticsDash.performance.topCard")}</h2>
        <Link to="/admin/reports#employer-performance" className="epf-top__link">{t("analyticsDash.performance.topCardAll")}</Link>
      </div>
      {status === "error" ? (
        <StateBlock kind="error" title={t("analyticsDash.errorTitle")} description={t("analyticsDash.errorText")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : status === "loading" ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : rows.length === 0 ? (
        <p className="asf__intro">{t("analyticsDash.performance.topCardEmpty")}</p>
      ) : (
        <ol className="epf-top__list">
          {rows.map((row) => (
            <li key={row.employerId}>
              <span className="epf-top__rank">{row.rank}</span>
              <Avatar name={row.name} photo={row.photo} size={28} />
              <span className="epf-top__name">{row.name}</span>
              <strong>{row.hires} <span className="ds-sr-only">{t("analyticsDash.performance.hires")}</span></strong>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
