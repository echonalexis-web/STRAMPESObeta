import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { adminAPI } from "../services/api";
import StateBlock from "./StateBlock";
import Avatar from "./Avatar";
import EmployerPerformanceDetail from "./EmployerPerformanceDetail";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_TOOLTIP } from "../utils/chartTheme";
import { manilaToday } from "../utils/analyticsFilterParams";
import { changeText } from "../utils/performanceFormat";
import "../styles/analytics-filters.css";

const LIMITS = [5, 10, 20, 50];

// Best and most performative employers: ranking for a quarter or a year, as a chart and a
// table that always agree (one response), with a drill-down per employer.
export default function EmployerPerformancePanel() {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const today = useMemo(() => manilaToday(), []);
  const [period, setPeriod] = useState("quarter");
  const [year, setYear] = useState(String(today.year));
  const [quarter, setQuarter] = useState(String(Math.floor((today.month - 1) / 3) + 1));
  const [limit, setLimit] = useState("10");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [selected, setSelected] = useState(null);
  const [asTable, setAsTable] = useState(false);

  const params = useMemo(
    () => ({ period, year, ...(period === "quarter" ? { quarter } : {}), limit }),
    [period, year, quarter, limit]
  );
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

  const data = loaded?.data || null;
  const status = failedKey === requestKey ? "error" : loaded?.key === requestKey ? "ready" : "loading";
  const years = Array.from({ length: 6 }, (_, i) => String(today.year - i));
  const noValue = t("analyticsDash.performance.noValue");
  const percent = (value) => (value === null || value === undefined ? noValue : `${value}%`);

  const chartData = (data?.rows || []).map((row) => ({ name: row.name, hires: row.hires }));
  const comparedTo = data
    ? data.previous.comparedTo === "same elapsed days"
      ? t("analyticsDash.performance.previousSame", { label: data.previous.label })
      : t("analyticsDash.performance.previousFull", { label: data.previous.label })
    : "";

  return (
    <section className="asf epf" id="employer-performance" aria-labelledby="epf-title">
      <header className="asf__head">
        <div>
          <h2 id="epf-title" className="asf__title">{t("analyticsDash.performance.title")}</h2>
          <p className="asf__intro">{t("analyticsDash.performance.intro")}</p>
        </div>
      </header>

      <form className="asf__bar" onSubmit={(event) => event.preventDefault()} aria-label={t("analyticsDash.filtersLabel")}>
        <div className="asf__row asf__row--period">
          <div className="asf-field">
            <label htmlFor="epf-period">{t("analyticsDash.performance.period")}</label>
            <select id="epf-period" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="quarter">{t("analyticsDash.performance.periodQuarter")}</option>
              <option value="year">{t("analyticsDash.performance.periodYear")}</option>
            </select>
          </div>
          <div className="asf-field">
            <label htmlFor="epf-year">{t("analyticsDash.performance.year")}</label>
            <select id="epf-year" value={year} onChange={(event) => setYear(event.target.value)}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          {period === "quarter" && (
            <div className="asf-field">
              <label htmlFor="epf-quarter">{t("analyticsDash.performance.quarter")}</label>
              <select id="epf-quarter" value={quarter} onChange={(event) => setQuarter(event.target.value)}>
                {["1", "2", "3", "4"].map((q) => <option key={q} value={q}>{t(`analyticsDash.quarters.${q}`)}</option>)}
              </select>
            </div>
          )}
          <div className="asf-field">
            <label htmlFor="epf-limit">{t("analyticsDash.performance.top")}</label>
            <select id="epf-limit" value={limit} onChange={(event) => setLimit(event.target.value)}>
              {LIMITS.map((value) => <option key={value} value={String(value)}>{value}</option>)}
            </select>
          </div>
        </div>
      </form>

      {status === "error" ? (
        <StateBlock kind="error" title={t("analyticsDash.errorTitle")} description={t("analyticsDash.errorText")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : (
        <div className={`asf__body${status === "loading" ? " is-stale" : ""}`} aria-busy={status === "loading"}>
          <p className="asf__period">
            {data.period.label}
            {data.period.isPartial ? ` (${t("analyticsDash.inProgress", { date: data.asOf.slice(0, 10) })})` : ""} · {comparedTo}
          </p>

          {data.rows.length === 0 ? (
            <StateBlock kind="empty" title={t("analyticsDash.performance.emptyTitle")} description={t("analyticsDash.performance.emptyText")} />
          ) : (
            <>
              <div className="epf__toggle">
                <button type="button" className="asf__chip" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
                  {asTable ? t("analyticsDash.performance.viewChart") : t("analyticsDash.performance.viewTable")}
                </button>
              </div>

              {!asTable && (
                <div
                  className="asf__chart"
                  role="img"
                  aria-label={`${t("analyticsDash.performance.chartLabel")}: ${chartData.map((row) => `${row.name} ${row.hires}`).join(", ")}`}
                >
                  <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 36 + 30)}>
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                      <CartesianGrid {...CHART_GRID} horizontal={false} />
                      <XAxis type="number" {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" {...CHART_AXIS} width={140} tickLine={false} axisLine={false} />
                      <Tooltip cursor={CHART_TOOLTIP.cursor} contentStyle={CHART_TOOLTIP.contentStyle} formatter={(value) => [value, t("analyticsDash.performance.hires")]} />
                      <Bar dataKey="hires" fill={CHART_SERIES[0]} radius={[0, 6, 6, 0]} maxBarSize={22} label={{ position: "right", fontSize: 12 }} isAnimationActive={!reduced} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="ds-table-wrap epf__table">
                <table className="ds-table">
                  <caption className="ds-sr-only">{t("analyticsDash.performance.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("analyticsDash.performance.rank")}</th>
                      <th scope="col">{t("analyticsDash.performance.employer")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.postings")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.applicants")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.hires")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.hireRate")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.fillRate")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.daysToHire")}</th>
                      {data.responseDataAvailable && <th scope="col" className="is-num">{t("analyticsDash.performance.responseRate")}</th>}
                      <th scope="col" className="is-num">{t("analyticsDash.performance.change")}</th>
                      <th scope="col"><span className="ds-sr-only">{t("analyticsDash.performance.details")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.employerId}>
                        <td className="is-num">{row.rank}</td>
                        <th scope="row">
                          <span className="epf__name"><Avatar name={row.name} photo={row.photo} size={28} />{row.name}</span>
                        </th>
                        <td className="is-num">{row.postings}</td>
                        <td className="is-num">{row.applicants}</td>
                        <td className="is-num">{row.hires}</td>
                        <td className="is-num">{row.hireRate === null ? noValue : t("analyticsDash.performance.hireRateOf", { rate: row.hireRate, n: row.hireRateN })}</td>
                        <td className="is-num">{percent(row.fillRate)}</td>
                        <td className="is-num">{row.medianDaysToHire ?? noValue}</td>
                        {data.responseDataAvailable && <td className="is-num">{percent(row.responseRate)}</td>}
                        <td className="is-num">{changeText(t, row.hiresChange)}</td>
                        <td>
                          <button type="button" className="asf__clear" onClick={() => setSelected(row)}>
                            {t("analyticsDash.performance.details")}<span className="ds-sr-only">: {row.name}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {data.notEnoughData.length > 0 && (
            <details className="asf__table">
              <summary>{t("analyticsDash.performance.notEnough")} ({data.notEnoughData.length})</summary>
              <p className="asf__note">{t("analyticsDash.performance.notEnoughHint")}</p>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("analyticsDash.performance.employer")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.postings")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.applicants")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.hires")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.notEnoughData.map((row) => (
                      <tr key={row.employerId}>
                        <th scope="row">{row.name}</th>
                        <td className="is-num">{row.postings}</td>
                        <td className="is-num">{row.applicants}</td>
                        <td className="is-num">{row.hires}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="asf__note">{t("analyticsDash.performance.rulesNote", { postings: data.rules.minPostings, applicants: data.rules.minApplicants })}</p>
          {data.eligibility.excluded > 0 && (
            <p className="asf__note">
              {t("analyticsDash.performance.excluded", { count: data.eligibility.excluded })}{" "}
              {t("analyticsDash.performance.formerLine", { hires: data.totals.formerOrRestricted.hires })}
            </p>
          )}
        </div>
      )}

      {selected && <EmployerPerformanceDetail employer={selected} params={params} onClose={() => setSelected(null)} />}
    </section>
  );
}
