import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { BriefcaseBusiness, FileText, UserRound, UserCheck } from "lucide-react";
import { adminAPI } from "../../services/api";
import AdminHeader from "./AdminHeader";
import MetricCard from "../../components/MetricCard";
import StateBlock from "../../components/StateBlock";
import Avatar from "../../components/Avatar";
import ReportGeneratorPanel from "../../components/ReportGeneratorPanel";
import { setupScope } from "../../utils/reportHistory";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES } from "../../utils/chartTheme";
import "../../styles/admin.css";
import "../../styles/admin-overview.css";

const PRESETS = ["7d", "30d", "90d", "12m", "custom"];
const MUNICIPALITIES = ["Boac (Capital)", "Santa Cruz", "Gasan", "Mogpog", "Torrijos", "Buenavista", "Other / Outside Province"];
const METRICS = ["applications", "hires", "vacancies"];
// Application statuses from dark to light so they differ by lightness, not hue alone; every segment is
// outlined and every row of the legend has its number.
const STATUS_SHADES = {
  pending: "#0b3d2e",
  under_review: "#1d6b4a",
  shortlisted: "#2f8f63",
  approved: "#58b085",
  hired: "#8ccaa7",
  rejected: "#bfe3cf",
  withdrawn: "#e3f3ea",
  other: "#f6fbf8",
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const readFilter = (searchParams) => {
  const preset = PRESETS.includes(searchParams.get("period")) ? searchParams.get("period") : "30d";
  const from = DATE.test(searchParams.get("from") || "") ? searchParams.get("from") : "";
  const to = DATE.test(searchParams.get("to") || "") ? searchParams.get("to") : "";
  const municipality = MUNICIPALITIES.includes(searchParams.get("municipality")) ? searchParams.get("municipality") : "";
  return { preset, from, to, municipality };
};

const writeFilter = ({ preset, from, to, municipality }) => {
  const params = new URLSearchParams();
  if (preset !== "30d") params.set("period", preset);
  if (preset === "custom") {
    if (from) params.set("from", from);
    if (to) params.set("to", to);
  }
  if (municipality) params.set("municipality", municipality);
  return params;
};

const cell = (t, entry) => (entry && entry.suppressed ? t("analyticsDash.underFive") : entry ? entry.value : 0);

// Analytics & Reports: how the province is doing over time. One filter bar drives every panel and the
// report generator.
export default function Reports() {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => readFilter(searchParams), [searchParams]);
  // "Set up again" in the report history: the report and file type go to the generator (a new nonce each time).
  const [prefill, setPrefill] = useState(null);
  const [metric, setMetric] = useState("applications");
  const [state, setState] = useState({ key: null, data: null, failed: null });
  const [attempt, setAttempt] = useState(0);

  const customReady = filter.preset !== "custom" || Boolean(filter.from && filter.to && filter.from <= filter.to);
  const params = useMemo(() => {
    const out = { period: filter.preset };
    if (filter.preset === "custom") Object.assign(out, { from: filter.from, to: filter.to });
    if (filter.municipality) out.municipality = filter.municipality;
    return out;
  }, [filter]);
  const key = `${JSON.stringify(params)}#${attempt}`;

  useEffect(() => {
    if (!customReady) return undefined;
    let live = true;
    adminAPI
      .getAnalyticsOverview(params)
      .then(({ data }) => live && setState({ key, data, failed: null }))
      .catch(() => live && setState({ key, data: null, failed: key }));
    return () => {
      live = false;
    };
  }, [params, key, customReady]);

  const update = (patch) => setSearchParams(writeFilter({ ...filter, ...patch }), { replace: true });
  // The history row's period and municipality become the page's filter; nothing is exported.
  const setUp = (item) => {
    setSearchParams(writeFilter(setupScope(item)), { replace: true });
    setPrefill({ dataset: item.dataset, format: item.format, nonce: Date.now() });
  };
  const failed = state.failed === key;
  const loading = customReady && !failed && state.key !== key;
  // The last answer stays on screen, dimmed, while a new one loads.
  const data = state.data;

  const periodText = filter.preset === "custom" ? `${filter.from || "…"} – ${filter.to || "…"}` : t("adminAnalytics.filter.last", { period: t(`adminAnalytics.filter.periods.${filter.preset}`) });
  const scopeText = `${periodText} · ${filter.municipality || t("adminAnalytics.filter.allMunicipalities")}`;

  const trendRows = data ? data.trend[metric] : [];
  const statusItems = data ? data.applicationsByStatus.items.filter((item) => item.key !== "other" || item.count > 0) : [];
  const employers = data ? data.topEmployers.rows : [];

  return (
    <div className="admin-page-container an">
      <AdminHeader title={t("adminAnalytics.title")} description={t("adminAnalytics.description")} />

      <section className="an__card" aria-labelledby="an-filter-title">
        <h2 id="an-filter-title" className="ds-sr-only">{t("adminAnalytics.filter.label")}</h2>
        <form className="an__bar" onSubmit={(event) => event.preventDefault()}>
          <div className="an__row">
            <div className="an-field an-field--period" role="group" aria-labelledby="an-period-label">
              <span id="an-period-label" className="an__plabel">{t("adminAnalytics.filter.period")}</span>
              <div className="an__chips">
                {PRESETS.map((preset) => (
                  <button key={preset} type="button" className="an__chip" aria-pressed={filter.preset === preset} onClick={() => update({ preset })}>
                    {t(`adminAnalytics.filter.periods.${preset}`)}
                  </button>
                ))}
              </div>
            </div>
            {filter.preset === "custom" && (
              <>
                <div className="an-field">
                  <label htmlFor="an-from">{t("adminAnalytics.filter.from")}</label>
                  <input id="an-from" type="date" value={filter.from} onChange={(event) => update({ from: event.target.value })} />
                </div>
                <div className="an-field">
                  <label htmlFor="an-to">{t("adminAnalytics.filter.to")}</label>
                  <input id="an-to" type="date" value={filter.to} onChange={(event) => update({ to: event.target.value })} />
                </div>
              </>
            )}
            <div className="an-field">
              <label htmlFor="an-municipality">{t("adminAnalytics.filter.municipality")}</label>
              <select id="an-municipality" value={filter.municipality} onChange={(event) => update({ municipality: event.target.value })}>
                <option value="">{t("adminAnalytics.filter.allMunicipalities")}</option>
                {MUNICIPALITIES.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <button type="button" className="an__btn" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              {t("adminAnalytics.filter.reset")}
            </button>
          </div>
          {!customReady && <p className="an__hint" role="alert">{t("adminAnalytics.filter.customHint")}</p>}
          <div className="an__meta">
            <p className="an__scope" role="status">{scopeText}</p>
            <p className="an__note">{t("adminAnalytics.filter.hint")}</p>
          </div>
        </form>
      </section>

      {!customReady ? null : failed ? (
        <StateBlock kind="error" title={t("adminAnalytics.errors.title")} description={t("adminAnalytics.errors.text")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : (
        <div className="an__body" style={loading ? { opacity: 0.6 } : undefined} aria-busy={loading}>
          <section className="an__cards ds-metrics" aria-label={t("adminAnalytics.cards.label")}>
            <MetricCard icon={<FileText size={20} />} value={data.cards.applications} label={t("adminAnalytics.cards.applications")} note={t("adminAnalytics.cards.applicationsNote")} />
            <MetricCard icon={<UserCheck size={20} />} value={data.cards.hires} label={t("adminAnalytics.cards.hires")} note={t("adminAnalytics.cards.hiresNote")} />
            <MetricCard
              icon={<BriefcaseBusiness size={20} />}
              value={data.cards.vacancies.total}
              label={t("adminAnalytics.cards.vacancies")}
              note={t("adminAnalytics.cards.vacanciesNote", { open: data.cards.vacancies.open, closed: data.cards.vacancies.closed, archived: data.cards.vacancies.archived })}
            />
            <MetricCard icon={<UserRound size={20} />} value={data.cards.jobseekers} label={t("adminAnalytics.cards.jobseekers")} note={t("adminAnalytics.cards.jobseekersNote")} />
          </section>

          <div className="an__main">
            <section className="an__card" aria-labelledby="an-trend-title">
              <h2 id="an-trend-title" className="an__h2">{t("adminAnalytics.trend.title")}</h2>
              <p className="an__sub">{t(`adminAnalytics.trend.granularity.${data.trend.granularity}`)}</p>
              <div className="an__metrics" role="group" aria-label={t("adminAnalytics.trend.metric")}>
                {METRICS.map((name) => (
                  <button key={name} type="button" className="an__chip" aria-pressed={metric === name} onClick={() => setMetric(name)}>
                    {t(`adminAnalytics.trend.metrics.${name}`)}
                  </button>
                ))}
              </div>
              <div className="an__chart" role="img" aria-label={`${t(`adminAnalytics.trend.metrics.${metric}`)}: ${trendRows.map((row) => `${row.label} ${row.value}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={trendRows} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" {...CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID.stroke }} interval="preserveStartEnd" />
                    <YAxis {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                    <Bar dataKey="value" fill={CHART_SERIES[0]} radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={!reduced}>
                      <LabelList dataKey="value" position="top" fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="an__details">
                <summary>{t("adminAnalytics.trend.viewTable")}</summary>
                <div className="ds-table-wrap">
                  <table className="an__table">
                    <caption className="ds-sr-only">{t(`adminAnalytics.trend.metrics.${metric}`)}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("adminAnalytics.trend.period")}</th>
                        <th scope="col">{t("adminAnalytics.trend.count")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendRows.map((row) => (
                        <tr key={row.key}>
                          <th scope="row">{row.label}</th>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>

            <div className="an__col">
              <section className="an__card" aria-labelledby="an-status-title">
                <h2 id="an-status-title" className="an__h2">{t("adminAnalytics.status.title")}</h2>
                <p className="an__sub">{t("adminAnalytics.status.intro", { total: data.applicationsByStatus.total })}</p>
                {data.applicationsByStatus.total === 0 ? (
                  <p className="an__empty">{t("adminAnalytics.status.empty")}</p>
                ) : (
                  <>
                    <div className="an__stack" aria-hidden="true">
                      {statusItems.filter((item) => item.count > 0).map((item) => (
                        <span key={item.key} className="an__seg" style={{ width: `${item.percent}%`, background: STATUS_SHADES[item.key] }} />
                      ))}
                    </div>
                    <ul className="an__legend">
                      {statusItems.map((item) => (
                        <li key={item.key}>
                          <span className="an__swatch" style={{ background: STATUS_SHADES[item.key] }} aria-hidden="true" />
                          <span className="an__lname">{t(`adminAnalytics.status.items.${item.key}`)}</span>
                          <span className="an__lnum">{t("adminAnalytics.status.line", { count: item.count, percent: item.percent })}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section className="an__card" aria-labelledby="an-vac-title">
                <h2 id="an-vac-title" className="an__h2">{t("adminAnalytics.vacancies.title")}</h2>
                <p className="an__sub">{t("adminAnalytics.vacancies.intro", { total: data.vacanciesByStatus.total })}</p>
                <div className="an__stats">
                  {data.vacanciesByStatus.items.map((item) => (
                    <div key={item.key} className="an__stat">
                      <span className="an__stat-num">{item.count}</span>
                      <span className="an__stat-label">{t(`adminAnalytics.vacancies.items.${item.key}`)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <div className="an__pair">
            <section className="an__card" aria-labelledby="an-emp-title">
              <h2 id="an-emp-title" className="an__h2">{t("adminAnalytics.employers.title")}</h2>
              <p className="an__sub">{t("adminAnalytics.employers.intro", data.topEmployers.minimums)}</p>
              {employers.length === 0 ? (
                <p className="an__empty an__empty--dashed">
                  <strong>{t("adminAnalytics.employers.emptyTitle")}</strong>
                  {t("adminAnalytics.employers.emptyText")}
                </p>
              ) : (
                <>
                  <div className="an__chart" role="img" aria-label={`${t("adminAnalytics.employers.chartLabel")}: ${employers.map((row) => `${row.name} ${row.hires}`).join(", ")}`}>
                    <ResponsiveContainer width="100%" height={Math.max(150, employers.length * 38 + 20)}>
                      <BarChart data={employers} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
                        <CartesianGrid {...CHART_GRID} horizontal={false} />
                        <XAxis type="number" {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" {...CHART_AXIS} width={120} tickLine={false} axisLine={false} />
                        <Bar dataKey="hires" fill={CHART_SERIES[0]} radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={!reduced}>
                          <LabelList dataKey="hires" position="right" fontSize={12} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <ol className="an__list">
                    {employers.map((row) => (
                      <li key={row.employerId}>
                        <Avatar name={row.name} photo={row.photo} size={28} />
                        <span className="an__lname">
                          {row.name}
                          <small>{[row.municipality, t("adminAnalytics.employers.hiresOf", { hires: row.hires, applicants: row.applicants })].filter(Boolean).join(" · ")}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>

            <section className="an__card" aria-labelledby="an-roles-title">
              <h2 id="an-roles-title" className="an__h2">{t("adminAnalytics.roles.title")}</h2>
              <p className="an__sub">{t("adminAnalytics.roles.intro")}</p>
              {data.topRoles.length === 0 ? (
                <p className="an__empty an__empty--dashed">{t("adminAnalytics.roles.empty")}</p>
              ) : (
                <ol className="an__list">
                  {data.topRoles.map((role) => (
                    <li key={role.title}>
                      <span className="an__lname">{role.title}</span>
                      <strong>{t("adminAnalytics.roles.count", { count: role.count })}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className="an__card" aria-labelledby="an-muni-title">
            <h2 id="an-muni-title" className="an__h2">{t("adminAnalytics.municipalities.title")}</h2>
            <p className="an__sub">{t("adminAnalytics.municipalities.intro")}</p>
            <div className="ds-table-wrap">
              <table className="an__table">
                <caption className="ds-sr-only">{t("adminAnalytics.municipalities.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("adminAnalytics.municipalities.municipality")}</th>
                    <th scope="col">{t("adminAnalytics.municipalities.applications")}</th>
                    <th scope="col">{t("adminAnalytics.municipalities.hires")}</th>
                    <th scope="col">{t("adminAnalytics.municipalities.vacancies")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.municipalities.map((row) => {
                    const selected = filter.municipality === row.municipality;
                    return (
                      <tr key={row.municipality}>
                        <th scope="row">
                          <button
                            type="button"
                            className="an__name"
                            aria-pressed={selected}
                            aria-label={selected ? t("adminAnalytics.municipalities.clear", { name: row.municipality }) : t("adminAnalytics.municipalities.select", { name: row.municipality })}
                            onClick={() => update({ municipality: selected ? "" : row.municipality })}
                          >
                            {row.municipality}
                          </button>
                        </th>
                        <td>{cell(t, row.applications)}</td>
                        <td>{cell(t, row.hires)}</td>
                        <td>{cell(t, row.vacancies)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <ReportGeneratorPanel scope={{ period: filter.preset, from: filter.from, to: filter.to, municipality: filter.municipality, text: scopeText, ready: customReady }} prefill={prefill} onSetUp={setUp} />
    </div>
  );
}
