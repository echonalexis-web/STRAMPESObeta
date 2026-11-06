import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { BriefcaseBusiness, Building2, ChartLine, ChartPie, FileText, ShieldCheck, UserRound, Users } from "lucide-react";
import { adminAPI } from "../../services/api";
import "../../styles/admin.css";
import AdminHeader from "./AdminHeader";
import ProvincialAnalyticsOverview from "./ProvincialAnalyticsOverview";
import MatchWeightDefaultsSettings from "../../components/MatchWeightDefaultsSettings";
import MetricCard from "../../components/MetricCard";
import Reveal from "../../components/Reveal";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_STATUS, CHART_TOOLTIP } from "../../utils/chartTheme";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Shared with Provincial Analytics Overview above (brand chart palette)
const TREND_COLORS = {
  applications: CHART_SERIES[0],
  registrations: CHART_SERIES[1],
};

// Application Status keeps its own semantic palette (AA-safe status hues)
const STATUS_COLORS = CHART_STATUS;

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
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
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
    { key: "totalAccounts", label: t("admin.kpi.totalAccounts"), icon: <Users size={20} />, value: analytics.totalAccounts },
    { key: "totalEmployers", label: t("admin.kpi.totalEmployers"), icon: <Building2 size={20} />, value: analytics.totalEmployers },
    { key: "jobSeekers", label: t("admin.kpi.jobSeekers"), icon: <UserRound size={20} />, value: analytics.totalJobSeekers },
    { key: "vacancies", label: t("admin.kpi.vacancies"), icon: <BriefcaseBusiness size={20} />, value: analytics.totalVacancies },
    { key: "applications", label: t("admin.kpi.applications"), icon: <FileText size={20} />, value: analytics.totalApplications },
    { key: "verifiedEmployers", label: t("admin.kpi.verifiedEmployers"), icon: <ShieldCheck size={20} />, value: analytics.verifiedEmployers },
  ], [analytics, t]);

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

      <section className="admin-kpis" aria-label={t("admin.kpi.sectionLabel")}>
        {loading ? (
          <div className="ds-metrics ds-metrics--3 admin-metrics" role="status" aria-label={t("common.loading")}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={`stat-loader-${index}`} className="ds-metric admin-metric--skeleton" aria-hidden="true">
                <span className="ds-skeleton admin-metric__skel-icon" />
                <span className="ds-skeleton admin-metric__skel-value" />
                <span className="ds-skeleton admin-metric__skel-label" />
              </div>
            ))}
          </div>
        ) : (
          <Reveal className="ds-metrics ds-metrics--3 admin-metrics">
            {stats.map((item) => (
              <MetricCard key={item.key} icon={item.icon} value={item.value} label={item.label} />
            ))}
          </Reveal>
        )}
      </section>

      <ProvincialAnalyticsOverview />

      <section className="admin-analytics-grid">
        <article className="admin-panel-card admin-chart-card">
          <div className="admin-card-header">
            <h2 className="admin-chart-title"><ChartLine size={18} aria-hidden="true" /> {t("admin.charts.trendTitle")}</h2>
          </div>
          <div className="admin-chart-wrap" role="img" aria-label={t("admin.charts.trendAria")}>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminRegistrationsArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TREND_COLORS.registrations} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={TREND_COLORS.registrations} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} vertical={false} />
                <XAxis dataKey="month" {...CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID.stroke }} />
                <YAxis {...CHART_AXIS} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                <Tooltip
                  cursor={CHART_TOOLTIP.cursor}
                  contentStyle={CHART_TOOLTIP.contentStyle}
                  formatter={(value, name) => [value, name === "applications" ? t("admin.charts.applications") : t("admin.charts.registrations")]}
                />
                <Bar dataKey="applications" fill={TREND_COLORS.applications} radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={!reduced} />
                <Area type="monotone" dataKey="registrations" stroke="none" fill="url(#adminRegistrationsArea)" isAnimationActive={!reduced} />
                <Line
                  type="monotone"
                  dataKey="registrations"
                  stroke={TREND_COLORS.registrations}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: TREND_COLORS.registrations, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reduced}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="admin-provincial-legend">
            <span><i style={{ background: TREND_COLORS.applications }} /> {t("admin.charts.applications")}</span>
            <span><i style={{ background: TREND_COLORS.registrations }} /> {t("admin.charts.registrations")}</span>
          </div>
          <details className="admin-chart-table">
            <summary className="admin-chart-table__toggle">
              <span className="admin-chart-table__show">{t("admin.charts.viewTable")}</span>
              <span className="admin-chart-table__hide">{t("admin.charts.hideTable")}</span>
            </summary>
            <div className="ds-table-wrap admin-chart-table__wrap">
              <table className="ds-table">
                <caption className="ds-sr-only">{t("admin.charts.trendTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("admin.charts.month")}</th>
                    <th scope="col" className="is-num">{t("admin.charts.applications")}</th>
                    <th scope="col" className="is-num">{t("admin.charts.registrations")}</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td className="is-num">{row.applications}</td>
                      <td className="is-num">{row.registrations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </article>

        <article className="admin-panel-card admin-chart-card">
          <div className="admin-card-header">
            <h2 className="admin-chart-title"><ChartPie size={18} aria-hidden="true" /> {t("admin.charts.statusTitle")}</h2>
          </div>
          <div className="admin-chart-wrap admin-chart-wrap--pie">
            <div className="admin-donut" role="img" aria-label={t("admin.charts.statusAria", { count: pieTotal })}>
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
                    isAnimationActive={!reduced}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP.contentStyle}
                    formatter={(value, name) => [t("admin.charts.applicationCount", { count: value }), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="admin-donut__center">
                <strong>{pieTotal}</strong>
                <span>{t("admin.charts.total")}</span>
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

      <MatchWeightDefaultsSettings />
    </div>
  );
}
