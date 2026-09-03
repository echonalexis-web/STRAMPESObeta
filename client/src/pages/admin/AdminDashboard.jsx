import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FaChartLine, FaBriefcase, FaBuilding, FaFileAlt, FaShieldAlt, FaUser, FaUsers } from "react-icons/fa";
import { adminAPI } from "../../services/api";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";
import ProvincialAnalyticsOverview from "./ProvincialAnalyticsOverview";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Shared with Provincial Analytics Overview above
const TREND_COLORS = {
  applications: "#10b981",
  registrations: "#065f46",
};
const CHART_AXIS = "#64748b";
const CHART_GRID = "#e5e7eb";
const CHART_TOOLTIP = { borderRadius: 10, border: "1px solid #e5e7eb", background: "#ffffff" };

// Application Status keeps its own multi-colour palette (exempt from the trend scheme)
const STATUS_COLORS = {
  pending: "#f59e0b",
  reviewed: "#3b82f6",
  shortlisted: "#8b5cf6",
  rejected: "#ef4444",
  hired: "#22c55e",
};

const fallbackAnalytics = {
  totalAccounts: 0,
  totalEmployers: 0,
  totalJobSeekers: 0,
  totalVacancies: 0,
  totalApplications: 0,
  verifiedEmployers: 0,
  auditEventsToday: 0,
  applicationsThisMonth: Array(12).fill(0),
  registrationsThisMonth: Array(12).fill(0),
  applicationsByStatus: {
    pending: 0,
    reviewed: 0,
    shortlisted: 0,
    rejected: 0,
    hired: 0,
  },
};

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState(fallbackAnalytics);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const { data } = await adminAPI.getAnalytics();
        if (isMounted) {
          setAnalytics(data || fallbackAnalytics);
        }
      } catch (error) {
        if (isMounted) {
          setAnalytics(fallbackAnalytics);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const stats = useMemo(() => [
    { label: "Total Accounts", icon: <FaUsers />, value: analytics.totalAccounts, color: "#22c55e", bg: "#dcfce7" },
    { label: "Total Employers", icon: <FaBuilding />, value: analytics.totalEmployers, color: "#3b82f6", bg: "#dbeafe" },
    { label: "Job Seekers", icon: <FaUser />, value: analytics.totalJobSeekers, color: "#8b5cf6", bg: "#ede9fe" },
    { label: "Vacancies", icon: <FaBriefcase />, value: analytics.totalVacancies, color: "#f59e0b", bg: "#fef3c7" },
    { label: "Applications", icon: <FaFileAlt />, value: analytics.totalApplications, color: "#06b6d4", bg: "#cffafe" },
    { label: "Verified Employers", icon: <FaShieldAlt />, value: analytics.verifiedEmployers, color: "#22c55e", bg: "#dcfce7" },
  ], [analytics]);

  const chartData = useMemo(() =>
    MONTH_LABELS.map((month, index) => ({
      month,
      applications: Number(analytics.applicationsThisMonth?.[index] || 0),
      registrations: Number(analytics.registrationsThisMonth?.[index] || 0),
    })),
    [analytics]
  );

  const pieData = useMemo(() => {
    const source = analytics.applicationsByStatus || {};
    return [
      { key: "pending", name: "Pending", value: Number(source.pending || 0) },
      { key: "reviewed", name: "Reviewed", value: Number(source.reviewed || 0) },
      { key: "shortlisted", name: "Shortlisted", value: Number(source.shortlisted || 0) },
      { key: "rejected", name: "Rejected", value: Number(source.rejected || 0) },
      { key: "hired", name: "Hired", value: Number(source.hired || 0) },
    ];
  }, [analytics]);

  const pieTotal = useMemo(() => pieData.reduce((sum, entry) => sum + entry.value, 0), [pieData]);

  return (
    <div className="admin-page-container">
      <AdminHeader
        title="Admin Dashboard"
        description="Monitor platform health, account growth, hiring activity, and operational performance across the province."
      />

      <section className="admin-stat-row">
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={`stat-loader-${index}`} className="admin-stat-card admin-stat-card--skeleton">
                <div className="admin-stat-icon skeleton-box" />
                <div className="skeleton-line w-32" />
                <div className="skeleton-line w-24" />
              </div>
            ))
          : stats.map((item) => (
              <article key={item.label} className="admin-stat-card" style={{ borderLeftColor: item.color }}>
                <span className="admin-stat-icon" style={{ background: item.bg, color: item.color }}>{item.icon}</span>
                <strong>{item.value}</strong>
                <p>{item.label}</p>
              </article>
            ))}
      </section>

      <ProvincialAnalyticsOverview />

      <section className="admin-analytics-grid">
        <article className="admin-panel-card">
          <div className="admin-card-header">
            <h3><FaChartLine /> Applications &amp; Registrations</h3>
          </div>
          <div className="admin-chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminRegistrationsArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TREND_COLORS.registrations} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={TREND_COLORS.registrations} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="month" stroke={CHART_AXIS} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                <YAxis stroke={CHART_AXIS} allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={30} />
                <Tooltip
                  cursor={{ fill: "rgba(6, 95, 70, 0.04)" }}
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value, name) => [value, name === "applications" ? "Applications" : "Registrations"]}
                />
                <Bar dataKey="applications" fill={TREND_COLORS.applications} radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Area type="monotone" dataKey="registrations" stroke="none" fill="url(#adminRegistrationsArea)" />
                <Line
                  type="monotone"
                  dataKey="registrations"
                  stroke={TREND_COLORS.registrations}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: TREND_COLORS.registrations, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="admin-provincial-legend">
            <span><i style={{ background: TREND_COLORS.applications }} /> Applications</span>
            <span><i style={{ background: TREND_COLORS.registrations }} /> Registrations</span>
          </div>
        </article>

        <article className="admin-panel-card">
          <div className="admin-card-header">
            <h3><FaChartLine /> Application Status</h3>
          </div>
          <div className="admin-chart-wrap admin-chart-wrap--pie">
            <div className="admin-donut">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                    cornerRadius={4}
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                    formatter={(value, name) => [`${value} application${value === 1 ? "" : "s"}`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="admin-donut__center">
                <strong>{pieTotal}</strong>
                <span>Total</span>
              </div>
            </div>
            <div className="admin-pie-legend">
              {pieData.map((entry) => {
                const pct = pieTotal ? Math.round((entry.value / pieTotal) * 100) : 0;
                return (
                  <div key={entry.key} className="admin-pie-legend-item">
                    <span className="swatch" style={{ background: STATUS_COLORS[entry.key] }} />
                    <span>{entry.name}</span>
                    <strong>{entry.value} · {pct}%</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
