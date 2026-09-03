import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminAPI } from "../../services/api";

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

      {error ? <div className="admin-form-error">{error}</div> : null}

      {loading ? (
        <div className="admin-provincial-panel admin-provincial-panel--loading">
          Loading provincial analytics...
        </div>
      ) : analytics ? (
        <>
          <div className="admin-provincial-kpis">
            <article className="admin-provincial-kpi">
              <span className="admin-provincial-kpi__label">Placement Rate</span>
              <strong>{readValue(metrics.placementRate)}%</strong>
            </article>
            <article className="admin-provincial-kpi">
              <span className="admin-provincial-kpi__label">Avg. Days to Fill</span>
              <strong>{readValue(metrics.avgDaysToFill)} days</strong>
            </article>
            <article className="admin-provincial-kpi">
              <span className="admin-provincial-kpi__label">Active vs. Closed Ratio</span>
              <strong>{buildRatioLabel(metrics.activeVacancies, metrics.closedVacancies)}</strong>
            </article>
          </div>

          <div className="admin-provincial-grid">
            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row">
                <h3>{year} Registration vs Application Trend</h3>
              </div>

              <div className="admin-provincial-chart">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(6, 95, 70, 0.04)" }}
                      contentStyle={{
                        borderRadius: "10px",
                        border: "1px solid #e5e7eb",
                        background: "#ffffff",
                      }}
                    />
                    <Bar dataKey="registered" fill="#065f46" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="applied" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="admin-provincial-legend">
                <span><i style={{ background: "#065f46" }} /> Registered</span>
                <span><i style={{ background: "#10b981" }} /> Applied</span>
              </div>
            </div>

            <div className="admin-provincial-panel">
              <div className="admin-provincial-panel__title-row admin-provincial-panel__title-row--with-toggle">
                <h3>{distributionView === "vacancies" ? "Marinduque Distribution" : "Applicant Municipality Origin"}</h3>
                <div className="admin-provincial-distribution-switch" aria-label="Distribution view switcher">
                  <button
                    type="button"
                    className={distributionView === "vacancies" ? "admin-provincial-toggle admin-provincial-toggle--active" : "admin-provincial-toggle"}
                    onClick={() => setDistributionView("vacancies")}
                  >
                    Vacancies
                  </button>
                  <button
                    type="button"
                    className={distributionView === "applicants" ? "admin-provincial-toggle admin-provincial-toggle--active" : "admin-provincial-toggle"}
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
                <div className="admin-provincial-chart admin-provincial-chart--compact">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={activeDistributionData} layout="vertical" margin={{ top: 12, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" horizontal={false} />
                      <XAxis type="number" stroke="#64748b" fontSize={12} allowDecimals={false} />
                      <YAxis type="category" dataKey="municipality" width={100} stroke="#64748b" fontSize={12} />
                      <Tooltip
                        cursor={{ fill: "rgba(16, 185, 129, 0.06)" }}
                        contentStyle={{
                          borderRadius: "10px",
                          border: "1px solid #e5e7eb",
                          background: "#ffffff",
                        }}
                      />
                      <Bar dataKey="value" fill="#10b981" radius={[0, 6, 6, 0]} />
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

              <div className="admin-provincial-table-wrap">
                <table className="admin-table admin-provincial-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Open Vacancies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.length > 0 ? (
                      roles.map((role) => (
                        <tr key={role.title}>
                          <td>{role.title}</td>
                          <td>{role.vacancies}</td>
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
