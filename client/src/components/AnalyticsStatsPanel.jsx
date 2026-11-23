import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SlidersHorizontal, X } from "lucide-react";
import { adminAPI } from "../services/api";
import MetricCard from "./MetricCard";
import StateBlock from "./StateBlock";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_TOOLTIP } from "../utils/chartTheme";
import {
  ACCOUNT_STATUSES,
  AGE_BRACKETS,
  APPLICATION_STATUSES,
  JOB_STATUSES,
  PERIOD_TYPES,
  SECTIONS,
  SECTION_FIELDS,
  VERIFICATION_OPTIONS,
  VERIFICATION_PENDING_REVIEW,
  WORK_NATURES,
  activeFilterKeys,
  clearedState,
  isCanonicalFilterQuery,
  isPeriodReady,
  parseFilterState,
  serializeFilterState,
  switchSection,
  toApiParams,
} from "../utils/analyticsFilterParams";
import { cellLabel } from "../utils/analyticsCellLabel";
import "../styles/analytics-filters.css";

const FALLBACK_YEARS = (() => {
  const year = new Date().getFullYear();
  return [year, year - 1, year - 2];
})();

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="asf-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

export default function AnalyticsStatsPanel() {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseFilterState(searchParams), [searchParams]);
  const [options, setOptions] = useState(null);
  // The answer is kept with the request it belongs to, so "loading" is derived (no setState in the effect).
  const [loaded, setLoaded] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const requestId = useRef(0);

  // A stale or hand-edited link is rewritten once.
  useEffect(() => {
    if (!isCanonicalFilterQuery(searchParams)) {
      setSearchParams(serializeFilterState(parseFilterState(searchParams)), { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let live = true;
    adminAPI
      .getAnalyticsFilterOptions()
      .then(({ data }) => live && setOptions(data))
      .catch(() => live && setOptions(null));
    return () => {
      live = false;
    };
  }, []);

  const update = useCallback(
    (patch) => setSearchParams(serializeFilterState({ ...state, ...patch }), { replace: true }),
    [state, setSearchParams]
  );

  const ready = isPeriodReady(state);
  const apiKey = JSON.stringify(toApiParams(state));
  const requestKey = `${apiKey}#${attempt}`;
  const summary = loaded ? loaded.data : null;
  const status = !ready ? "idle" : failedKey === requestKey ? "error" : loaded?.key === requestKey ? "ready" : "loading";

  useEffect(() => {
    if (!ready) return undefined;
    const id = requestId.current + 1;
    requestId.current = id;
    const controller = new AbortController();
    adminAPI
      .getAnalyticsSummary(JSON.parse(apiKey), { signal: controller.signal })
      .then(({ data }) => {
        // A slower, older answer must never replace a newer one.
        if (requestId.current !== id) return;
        setLoaded({ key: requestKey, data });
      })
      .catch((error) => {
        if (requestId.current !== id || error?.code === "ERR_CANCELED") return;
        setFailedKey(requestKey);
      });
    return () => controller.abort();
  }, [apiKey, ready, requestKey]);

  const years = options?.years?.length ? options.years : FALLBACK_YEARS;
  const shown = new Set(SECTION_FIELDS[state.section]);
  const activeKeys = activeFilterKeys(state);
  const panelCount = activeKeys.length;
  const fieldId = (name) => `asf-${name}`;
  const choices = (list, path) =>
    list.map((value) => (
      <option key={value} value={value}>
        {t(`analyticsDash.${path}.${value}`, { defaultValue: value })}
      </option>
    ));
  const allOption = <option value="">{t("analyticsDash.all")}</option>;

  const cards = summary?.cards || [];
  const series = summary?.series?.[0];
  const isEmpty = status === "ready" && cards.every((card) => !card.value && !card.suppressed);
  const hasSuppressed =
    cards.some((card) => card.suppressed) ||
    (summary?.breakdowns || []).some((b) => b.items.some((item) => item.suppressed)) ||
    (series?.points || []).some((point) => point.suppressed);

  const periodText = summary?.period
    ? summary.period.isPartial
      ? `${summary.period.label} (${t("analyticsDash.inProgress", { date: summary.period.asOf.slice(0, 10) })})`
      : summary.period.label
    : "";

  return (
    <section className="asf" aria-labelledby="asf-title">
      <header className="asf__head">
        <div>
          <h2 id="asf-title" className="asf__title">{t("analyticsDash.title")}</h2>
          <p className="asf__intro">{t("analyticsDash.intro")}</p>
        </div>
      </header>

      <div className="asf__tabs" role="group" aria-label={t("analyticsDash.fields.dataset")}>
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className="asf__tab"
            aria-pressed={state.section === section}
            onClick={() => setSearchParams(serializeFilterState(switchSection(state, section)), { replace: true })}
          >
            {t(`analyticsDash.sections.${section}`)}
          </button>
        ))}
      </div>

      <form className="asf__bar" aria-label={t("analyticsDash.filtersLabel")} onSubmit={(event) => event.preventDefault()}>
        <div className="asf__row asf__row--period">
          <Select id={fieldId("period")} label={t("analyticsDash.fields.period")} value={state.period} onChange={(value) => update({ period: value })}>
            {PERIOD_TYPES.map((type) => <option key={type} value={type}>{t(`analyticsDash.periods.${type}`)}</option>)}
          </Select>
          {state.period !== "custom" && (
            <Select id={fieldId("year")} label={t("analyticsDash.fields.year")} value={state.year} onChange={(value) => update({ year: value })}>
              {[...new Set([...years.map(String), state.year])].map((year) => <option key={year} value={year}>{year}</option>)}
            </Select>
          )}
          {state.period === "quarter" && (
            <Select id={fieldId("quarter")} label={t("analyticsDash.fields.quarter")} value={state.quarter} onChange={(value) => update({ quarter: value })}>
              {["1", "2", "3", "4"].map((q) => <option key={q} value={q}>{t(`analyticsDash.quarters.${q}`)}</option>)}
            </Select>
          )}
          {state.period === "month" && (
            <Select id={fieldId("month")} label={t("analyticsDash.fields.month")} value={state.month} onChange={(value) => update({ month: value })}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => <option key={m} value={m}>{t(`analyticsDash.months.${m}`)}</option>)}
            </Select>
          )}
          {state.period === "custom" && (
            <>
              <div className="asf-field">
                <label htmlFor={fieldId("from")}>{t("analyticsDash.fields.from")}</label>
                <input id={fieldId("from")} type="date" value={state.from} onChange={(event) => update({ from: event.target.value })} />
              </div>
              <div className="asf-field">
                <label htmlFor={fieldId("to")}>{t("analyticsDash.fields.to")}</label>
                <input id={fieldId("to")} type="date" value={state.to} onChange={(event) => update({ to: event.target.value })} />
              </div>
            </>
          )}
          <button
            type="button"
            className="asf__toggle"
            aria-expanded={panelOpen}
            aria-controls="asf-more"
            onClick={() => setPanelOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            {panelCount ? t("analyticsDash.filtersButtonCount", { count: panelCount }) : t("analyticsDash.filtersButton")}
          </button>
        </div>

        <div id="asf-more" className={`asf__row asf__more${panelOpen ? " is-open" : ""}`}>
          {shown.has("municipality") && (
            <Select id={fieldId("municipality")} label={t("analyticsDash.fields.municipality")} value={state.municipality} onChange={(value) => update({ municipality: value })}>
              {allOption}
              {(options?.municipalities || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          )}
          {shown.has("dataset") && (
            <Select id={fieldId("dataset")} label={t("analyticsDash.fields.dataset")} value={state.dataset} onChange={(value) => update({ dataset: value })}>
              {choices(["regular", "spes"], "datasets")}
            </Select>
          )}
          {shown.has("industry") && state.dataset !== "spes" && (
            <Select id={fieldId("industry")} label={t("analyticsDash.fields.industry")} value={state.industry} onChange={(value) => update({ industry: value })}>
              {allOption}
              {(options?.industries || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          )}
          {shown.has("jobType") && state.dataset !== "spes" && (
            <Select id={fieldId("jobType")} label={t("analyticsDash.fields.jobType")} value={state.jobType} onChange={(value) => update({ jobType: value })}>
              {allOption}
              {(options?.jobTypes || []).map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          )}
          {shown.has("workNature") && state.dataset !== "spes" && (
            <Select id={fieldId("workNature")} label={t("analyticsDash.fields.workNature")} value={state.workNature} onChange={(value) => update({ workNature: value })}>
              {allOption}
              {choices(WORK_NATURES, "workNatures")}
            </Select>
          )}
          {shown.has("jobStatus") && state.dataset !== "spes" && (
            <Select id={fieldId("jobStatus")} label={t("analyticsDash.fields.jobStatus")} value={state.jobStatus} onChange={(value) => update({ jobStatus: value })}>
              {allOption}
              {choices(JOB_STATUSES, "jobStatuses")}
            </Select>
          )}
          {shown.has("verification") && (
            <Select id={fieldId("verification")} label={t("analyticsDash.fields.verification")} value={state.verification} onChange={(value) => update({ verification: value })}>
              {allOption}
              <option value={VERIFICATION_PENDING_REVIEW}>{t(`analyticsDash.verificationValues.${VERIFICATION_PENDING_REVIEW}`)}</option>
              {choices(VERIFICATION_OPTIONS, "verificationValues")}
            </Select>
          )}
          {shown.has("accountStatus") && (
            <Select id={fieldId("accountStatus")} label={t("analyticsDash.fields.accountStatus")} value={state.accountStatus} onChange={(value) => update({ accountStatus: value })}>
              {allOption}
              {choices(ACCOUNT_STATUSES, "accountStatuses")}
            </Select>
          )}
          {shown.has("dateField") && (
            <Select id={fieldId("dateField")} label={t("analyticsDash.fields.dateField")} value={state.dateField} onChange={(value) => update({ dateField: value })}>
              {choices(["applied", "registered"], "dateFields")}
            </Select>
          )}
          {shown.has("ageBracket") && state.dataset !== "spes" && (
            <Select id={fieldId("ageBracket")} label={t("analyticsDash.fields.ageBracket")} value={state.ageBracket} onChange={(value) => update({ ageBracket: value })}>
              {allOption}
              {AGE_BRACKETS.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          )}
          {shown.has("applicationStatus") && state.dateField !== "registered" && state.dataset !== "spes" && (
            <Select id={fieldId("applicationStatus")} label={t("analyticsDash.fields.applicationStatus")} value={state.applicationStatus} onChange={(value) => update({ applicationStatus: value })}>
              {allOption}
              {choices(APPLICATION_STATUSES, "applicationStatuses")}
            </Select>
          )}
          {shown.has("scope") && (
            <div className="asf-field asf-field--chips">
              <span id="asf-scope-label">{t("analyticsDash.fields.scope")}</span>
              <div role="group" aria-labelledby="asf-scope-label" className="asf__chips">
                {["all", "public"].map((value) => (
                  <button key={value} type="button" className="asf__chip" aria-pressed={state.scope === value} onClick={() => update({ scope: value })}>
                    {value === "all" ? t("analyticsDash.all") : t("analyticsDash.scopes.public")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="asf__foot">
          {state.period === "custom" && !ready && <p className="asf__hint">{t("analyticsDash.customHint")}</p>}
          {panelCount > 0 && (
            <button type="button" className="asf__clear" onClick={() => setSearchParams(serializeFilterState(clearedState(state)), { replace: true })}>
              <X size={14} aria-hidden="true" /> {t("analyticsDash.clear")}
            </button>
          )}
        </div>
      </form>

      <p className="ds-sr-only" role="status" aria-live="polite">
        {status === "ready" && periodText ? t("analyticsDash.announce", { period: periodText }) : ""}
      </p>

      {!ready ? null : status === "error" ? (
        <StateBlock kind="error" title={t("analyticsDash.errorTitle")} description={t("analyticsDash.errorText")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : status === "loading" && !summary ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : summary ? (
        <div className={`asf__body${status === "loading" ? " is-stale" : ""}`} aria-busy={status === "loading"}>
          {periodText && <p className="asf__period">{periodText}</p>}
          {isEmpty ? (
            <StateBlock
              kind="empty"
              title={t("analyticsDash.emptyTitle")}
              description={t("analyticsDash.emptyText")}
              action={panelCount > 0 ? (
                <button type="button" className="asf__clear" onClick={() => setSearchParams(serializeFilterState(clearedState(state)), { replace: true })}>
                  {t("analyticsDash.clear")}
                </button>
              ) : null}
            />
          ) : (
            <>
              <div className="ds-metrics ds-metrics--3 asf__cards">
                {cards.map((card) => (
                  <MetricCard
                    key={card.key}
                    value={card.suppressed ? t("analyticsDash.underFive") : card.value}
                    label={t(`analyticsDash.cards.${card.key}`)}
                  />
                ))}
              </div>

              {series && (
                <article className="asf__panel">
                  <h3 className="asf__panel-title">{t(`analyticsDash.series.${series.key}`)}</h3>
                  <div className="asf__chart" role="img" aria-label={`${t(`analyticsDash.series.${series.key}`)}: ${series.points.map((p) => `${p.label} ${p.suppressed ? t("analyticsDash.underFive") : p.value}`).join(", ")}`}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={series.points.map((p) => ({ ...p, shown: p.value ?? 0 }))} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid {...CHART_GRID} vertical={false} />
                        <XAxis dataKey="label" {...CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID.stroke }} />
                        <YAxis {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                        <Tooltip cursor={CHART_TOOLTIP.cursor} contentStyle={CHART_TOOLTIP.contentStyle} formatter={(value, name, item) => [item.payload.suppressed ? t("analyticsDash.underFive") : value, t(`analyticsDash.series.${series.key}`)]} />
                        <Bar dataKey="shown" fill={CHART_SERIES[0]} radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={!reduced} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="asf__table">
                    <summary>{t("analyticsDash.viewTable")}</summary>
                    <div className="ds-table-wrap">
                      <table className="ds-table">
                        <caption className="ds-sr-only">{t(`analyticsDash.series.${series.key}`)}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{t("analyticsDash.table.month")}</th>
                            <th scope="col" className="is-num">{t("analyticsDash.table.count")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.points.map((point) => (
                            <tr key={point.key}>
                              <td>{point.label}</td>
                              <td className="is-num">{point.suppressed ? t("analyticsDash.underFive") : point.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </article>
              )}

              <div className="asf__breakdowns">
                {(summary.breakdowns || []).map((item) => {
                  const max = Math.max(1, ...item.items.map((cell) => cell.value || 0));
                  return (
                    <article key={item.key} className="asf__panel">
                      <h3 className="asf__panel-title">{t(`analyticsDash.breakdowns.${item.key}`)}</h3>
                      <table className="asf__rows">
                        <caption className="ds-sr-only">{t(`analyticsDash.breakdowns.${item.key}`)}</caption>
                        <thead className="ds-sr-only">
                          <tr>
                            <th scope="col">{t("analyticsDash.table.label")}</th>
                            <th scope="col">{t("analyticsDash.table.count")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.items.map((cell) => (
                            <tr key={cell.key}>
                              <th scope="row">{cellLabel(t, item.key, cell.key, { section: state.section, dataset: state.dataset })}</th>
                              <td>
                                <span className="asf__bar-track" aria-hidden="true">
                                  <span className="asf__bar-fill" style={{ width: `${cell.suppressed ? 0 : Math.round(((cell.value || 0) / max) * 100)}%` }} />
                                </span>
                                <strong>{cell.suppressed ? t("analyticsDash.underFive") : cell.value}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                  );
                })}
              </div>
              {hasSuppressed && <p className="asf__note">{t("analyticsDash.suppressedNote")}</p>}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
