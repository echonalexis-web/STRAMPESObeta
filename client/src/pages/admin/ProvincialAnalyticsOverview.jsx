import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, Scale, TrendingUp } from "lucide-react";
import { adminAPI } from "../../services/api";
import MetricCard from "../../components/MetricCard";
import StateBlock from "../../components/StateBlock";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_TOOLTIP } from "../../utils/chartTheme";

// Same pairing as the dashboard trend chart: registrations gold, applications green.
const SERIES = {
  registered: CHART_SERIES[1],
  applied: CHART_SERIES[0],
  distribution: CHART_SERIES[0],
};

const MUNICIPALITY_OPTIONS = [
  { value: "ALL", label: "All Marinduque" },
  { value: "Boac", label: "Boac" },
  { value: "Santa Cruz", label: "Santa Cruz" },
  { value: "Gasan", label: "Gasan" },
  { value: "Mogpog", label: "Mogpog" },
  { value: "Torrijos", label: "Torrijos" },
  { value: "Buenavista", label: "Buenavista" },
];

const buildRatioLabel = (active, closed) => `${Number(active || 0)}:${Number(closed || 0)}`;

export default function ProvincialAnalyticsOverview() {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [selectedMunicipality, setSelectedMunicipality] = useState("ALL");
  const [year, setYear] = useState(2026);
  const [distributionView, setDistributionView] = useState("vacancies");
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const { data } = await adminAPI.getProvincialAnalytics({
          year,
          municipality: selectedMunicipality,
        });
        setAnalytics(data);
        setError("");
      } catch (err) {
        setAnalytics(null);
        setError(err.response?.data?.message || "Failed to load provincial analytics");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [selectedMunicipality, year]);

  const chartData = useMemo(() => analytics?.months || [], [analytics]);
  const sectors = useMemo(() => analytics?.topSectors || [], [analytics]);
  const roles = useMemo(() => analytics?.topRoles || [], [analytics]);
  const municipalities = useMemo(() => analytics?.municipalities || [], [analytics]);
  const applicantMunicipalities = useMemo(() => analytics?.applicantMunicipalities || [], [analytics]);
  const activeDistributionData = distributionView === "vacancies" ? municipalities : applicantMunicipalities;

  const readValue = (path, fallback = 0) => {
    const value = path ? Number(path) : fallback;
    return Number.isFinite(value) ? value : fallback;
  };

  const metrics = analytics?.metrics || {};

  return (
    <section className="admin-provincial-section">
      <div className="admin-provincial-header">
        <div>
          <h2>Provincial Analytics Overview</h2>
          <p>Employment facilitation statistics, monthly registrations, hiring rates, and municipal distribution.</p>
        </div>

        <div className="admin-provincial-header__filters">
          <label className="admin-provincial-field">
            <span>Municipality</span>
            <select
              value={selectedMunicipality}
              onChange={(event) => setSelectedMunicipality(event.target.value)}
            >
              {MUNICIPALITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-provincial-field">
            <span>Year</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {[2024, 2025, 2026].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <StateBlock kind="error" description={error} className="admin-provincial-state" />
      ) : null}

      {loading ? (
        <StateBlock kind="loading" title={t("admin.states.provincialLoading")} className="admin-provincial-state" />
      ) : analytics ? (
        <>
          <div className="ds-metrics ds-metrics--3 admin-provincial-kpis">
            <MetricCard
              icon={<TrendingUp size={20} />}
              value={`${readValue(metrics.placementRate)}%`}
              label={t("admin.provincial.placementRate")}
            />
            <MetricCard
              icon={<CalendarClock size={20} />}
              value={t("admin.provincial.days", { count: readValue(metrics.avgDaysToFill) })}
              label={t("admin.provincial.avgDaysToFill")}
            />
            <MetricCard
              icon={<Scale size={20} />}
              value={buildRatioLabel(metrics.activeVacancies, metrics.closedVacancies)}
              label={t("admin.provincial.activeClosedRatio")}
            />
          </div>

          <div className="admin-provincial-grid">
            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row">
                <h3>{t("admin.provincial.trendTitle", { year })}</h3>
              </div>

              <div className="admin-provincial-chart" role="img" aria-label={t("admin.charts.provincialTrendAria", { year })}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid {...CHART_GRID} vertical={false} />
                    <XAxis dataKey="month" {...CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID.stroke }} />
                    <YAxis {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={CHART_TOOLTIP.cursor}
                      contentStyle={CHART_TOOLTIP.contentStyle}
                    />
                    <Bar dataKey="registered" fill={SERIES.registered} radius={[6, 6, 0, 0]} isAnimationActive={!reduced} />
                    <Bar dataKey="applied" fill={SERIES.applied} radius={[6, 6, 0, 0]} isAnimationActive={!reduced} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="admin-provincial-legend">
                <span><i style={{ background: SERIES.registered }} /> {t("admin.provincial.registered")}</span>
                <span><i style={{ background: SERIES.applied }} /> {t("admin.provincial.applied")}</span>
              </div>

              <details className="admin-chart-table">
                <summary className="admin-chart-table__toggle">
                  <span className="admin-chart-table__show">{t("admin.charts.viewTable")}</span>
                  <span className="admin-chart-table__hide">{t("admin.charts.hideTable")}</span>
                </summary>
                <div className="ds-table-wrap admin-chart-table__wrap">
                  <table className="ds-table">
                    <caption className="ds-sr-only">{t("admin.provincial.trendTitle", { year })}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("admin.charts.month")}</th>
                        <th scope="col" className="is-num">{t("admin.provincial.registered")}</th>
                        <th scope="col" className="is-num">{t("admin.provincial.applied")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((row) => (
                        <tr key={row.month}>
                          <td>{row.month}</td>
                          <td className="is-num">{row.registered}</td>
                          <td className="is-num">{row.applied}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row admin-provincial-panel__title-row--with-toggle">
                <h3>{distributionView === "vacancies" ? "Marinduque Distribution" : "Applicant Municipality Origin"}</h3>
                <div className="admin-provincial-distribution-switch" role="group" aria-label={t("admin.provincial.distributionSwitch")}>
                  <button
                    type="button"
                    className={distributionView === "vacancies" ? "admin-provincial-toggle admin-provincial-toggle--active" : "admin-provincial-toggle"}
                    aria-pressed={distributionView === "vacancies"}
                    onClick={() => setDistributionView("vacancies")}
                  >
                    Vacancies
                  </button>
                  <button
                    type="button"
                    className={distributionView === "applicants" ? "admin-provincial-toggle admin-provincial-toggle--active" : "admin-provincial-toggle"}
                    aria-pressed={distributionView === "applicants"}
                    onClick={() => setDistributionView("applicants")}
                  >
                    Applicants
                  </button>
                </div>
              </div>

              {distributionView === "vacancies" ? (
                <div className="admin-provincial-distribution">
                  {municipalities.length > 0 ? (
                    municipalities.map((item) => (
                      <div key={item.municipality} className="admin-provincial-distribution__row">
                        <div className="admin-provincial-distribution__meta">
                          <span>{item.municipality}</span>
                          <strong>{item.percent}% ({item.value})</strong>
                        </div>
                        <div className="admin-provincial-progress-bar">
                          <span style={{ width: `${Math.max(item.percent, 4)}%` }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="admin-empty-state">No municipal distribution data available.</p>
                  )}
                </div>
              ) : (
                <div
                  className="admin-provincial-chart admin-provincial-chart--compact"
                  role="img"
                  aria-label={t("admin.charts.applicantOriginAria")}
                >
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={activeDistributionData} layout="vertical" margin={{ top: 12, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid {...CHART_GRID} horizontal={false} />
                      <XAxis type="number" {...CHART_AXIS} allowDecimals={false} tickLine={false} />
                      <YAxis type="category" dataKey="municipality" width={100} {...CHART_AXIS} tickLine={false} />
                      <Tooltip
                        cursor={CHART_TOOLTIP.cursor}
                        contentStyle={CHART_TOOLTIP.contentStyle}
                      />
                      <Bar dataKey="value" fill={SERIES.distribution} radius={[0, 6, 6, 0]} isAnimationActive={!reduced} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="admin-provincial-bottom-grid">
            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row">
                <h3>Top Industry Sectors</h3>
              </div>

              <div className="admin-provincial-ranked-list">
                {sectors.length > 0 ? (
                  sectors.map((sector) => (
                    <div key={sector.sector} className="admin-provincial-ranked-item">
                      <div className="admin-provincial-ranked-item__meta">
                        <span>{sector.sector}</span>
                        <strong>{sector.vacancies}</strong>
                      </div>
                      <div className="admin-provincial-progress-bar admin-provincial-progress-bar--small">
                        <span style={{ width: `${Math.min((sector.vacancies / Math.max(sectors[0]?.vacancies || 1, 1)) * 100, 100)}%` }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="admin-empty-state">No sector data available.</p>
                )}
              </div>
            </div>

            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row">
                <h3>Top In-Demand Roles</h3>
              </div>

              <div className="admin-provincial-table-wrap ds-table-wrap">
                <table className="admin-table admin-provincial-table ds-table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col" className="is-num">Open Vacancies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.length > 0 ? (
                      roles.map((role) => (
                        <tr key={role.title}>
                          <td>{role.title}</td>
                          <td className="is-num">{role.vacancies}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="admin-empty-state">No role data available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
