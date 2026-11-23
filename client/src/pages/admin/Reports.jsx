import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  FaBriefcase,
  FaBuilding,
  FaDownload,
  FaFileAlt,
  FaUser,
} from "react-icons/fa";
import {
  Archive,
  BriefcaseBusiness,
  Building2,
  ChartLine,
  ChartPie,
  CircleCheck,
  FileText,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { adminAPI } from "../../services/api";
import { useToast } from "../../components/feedback/context";
import { exportCsv, exportPdfTable } from "../../utils/exportUtils";
import "../../styles/admin.css";
import "../../styles/reports.css";
import AdminHeader from "./AdminHeader";
import AnalyticsStatsPanel from "../../components/AnalyticsStatsPanel";
import MetricCard from "../../components/MetricCard";
import Reveal from "../../components/Reveal";
import StateBlock from "../../components/StateBlock";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion";
import { CHART_AXIS, CHART_GRID, CHART_SERIES, CHART_STATUS, CHART_TOOLTIP } from "../../utils/chartTheme";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TREND_COLORS = { applications: CHART_SERIES[0], registrations: CHART_SERIES[1] };
const STATUS_COLORS = CHART_STATUS;

// Columns whose cells are counts: right-aligned tabular numbers in the table.
const NUMERIC_COLUMNS = new Set(["slots", "applicants"]);

const MUNICIPALITY_OPTIONS = [
  "All Marinduque",
  "Boac (Capital)",
  "Santa Cruz",
  "Gasan",
  "Mogpog",
  "Torrijos",
  "Buenavista",
  "Other / Outside Province",
];
const JOB_STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Pending review", value: "review" },
  { label: "Active", value: "active" },
  { label: "Closed / Filled", value: "closed" },
  { label: "Rejected", value: "rejected" },
];
const USER_STATUS_OPTIONS = ["All", "Active", "Inactive"];
const VERIFICATION_OPTIONS = ["All", "verified", "pending", "unverified"];

const cap = (value) => {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
};

const TABS = [
  { key: "applicants", label: "Applicants", icon: <FaUser /> },
  { key: "jobs", label: "Jobs", icon: <FaBriefcase /> },
  { key: "employers", label: "Employers", icon: <FaBuilding /> },
];

// Contact details stay out of every file this page exports (the table on screen is unchanged).
const EXPORT_EXCLUDED_COLUMNS = new Set(["email", "username"]);
const exportable = (cols) => cols.filter((col) => !EXPORT_EXCLUDED_COLUMNS.has(col.key));

const PAGE_SIZE = 15;
const EXPORT_LIMIT = 500;

const fallbackAnalytics = {
  totalAccounts: 0,
  totalEmployers: 0,
  totalJobSeekers: 0,
  totalVacancies: 0,
  totalApplications: 0,
  verifiedEmployers: 0,
  pendingVerification: 0,
  activeJobs: 0,
  closedJobs: 0,
  auditEventsToday: 0,
  applicationsThisMonth: Array(12).fill(0),
  registrationsThisMonth: Array(12).fill(0),
  applicationsByStatus: { pending: 0, reviewed: 0, shortlisted: 0, rejected: 0, hired: 0 },
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const TAB_TITLES = {
  applicants: "Applicants Report",
  jobs: "Job Vacancies Report",
  employers: "Employers Report",
};

/* ---------- per-tab query + column config ---------- */
const buildUserParams = (filters, role, page, limit) => ({
  role,
  page,
  limit,
  search: filters.search || undefined,
  isActive:
    filters.userStatus === "Active" ? "true" : filters.userStatus === "Inactive" ? "false" : undefined,
  verificationStatus:
    role === "employer" && filters.verification !== "All" ? filters.verification : undefined,
});

const buildJobParams = (filters, page, limit) => ({
  page,
  limit,
  search: filters.search || undefined,
  municipality: filters.municipality === "All Marinduque" ? "all" : filters.municipality,
  status: filters.jobStatus || "all",
});

const USER_COLUMNS = [
  { key: "name", label: "Name", get: (r) => r.name || "—" },
  { key: "email", label: "Email", get: (r) => r.email || "—" },
  { key: "username", label: "Username", get: (r) => r.username || "—" },
  { key: "status", label: "Status", get: (r) => (r.isActive === false ? "Inactive" : "Active") },
  { key: "joined", label: "Joined", get: (r) => formatDate(r.createdAt) },
];

const APPLICANT_COLUMNS = [
  ...USER_COLUMNS.slice(0, 3),
  { key: "onboarding", label: "Onboarding", get: (r) => (r.hasCompletedOnboarding ? "Complete" : "Pending") },
  { key: "joined", label: "Joined", get: (r) => formatDate(r.createdAt) },
];

const EMPLOYER_COLUMNS = [
  ...USER_COLUMNS.slice(0, 2),
  { key: "verification", label: "Verification", get: (r) => cap(r.verificationStatus || "unverified") },
  { key: "status", label: "Status", get: (r) => (r.isActive === false ? "Inactive" : "Active") },
  { key: "joined", label: "Joined", get: (r) => formatDate(r.createdAt) },
];

const JOB_COLUMNS = [
  { key: "title", label: "Job title", get: (r) => r.title || "—" },
  { key: "employer", label: "Employer", get: (r) => r.employer?.companyName || r.employer?.name || "—" },
  { key: "municipality", label: "Municipality", get: (r) => r.municipality || "—" },
  { key: "status", label: "Status", get: (r) => cap(r.status) },
  { key: "slots", label: "Slots", get: (r) => Number(r.slots || 0) },
  { key: "applicants", label: "Applicants", get: (r) => Number(r.applicantCount ?? r.applicants ?? 0) },
  { key: "posted", label: "Posted", get: (r) => formatDate(r.createdAt) },
];

export default function Reports() {
  const { t } = useTranslation();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const [analytics, setAnalytics] = useState(fallbackAnalytics);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const [tab, setTab] = useState("applicants");
  const [filters, setFilters] = useState({
    search: "",
    userStatus: "All",
    verification: "All",
    municipality: "All Marinduque",
    jobStatus: "all",
  });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let mounted = true;
    adminAPI
      .getAnalytics()
      .then(({ data }) => mounted && setAnalytics(data || fallbackAnalytics))
      .catch(() => mounted && setAnalytics(fallbackAnalytics))
      .finally(() => mounted && setAnalyticsLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const fetchRows = useCallback(
    async (targetPage, limit) => {
      if (tab === "jobs") {
        const { data } = await adminAPI.getAdminVacancies(buildJobParams(filters, targetPage, limit));
        return {
          rows: Array.isArray(data?.jobs) ? data.jobs : [],
          total: data?.total || 0,
          totalPages: data?.totalPages || 1,
        };
      }
      const role = tab === "employers" ? "employer" : "jobseeker";
      const { data } = await adminAPI.getUsers(buildUserParams(filters, role, targetPage, limit));
      return {
        rows: Array.isArray(data?.users) ? data.users : [],
        total: data?.total || 0,
        totalPages: data?.totalPages || 1,
      };
    },
    [tab, filters],
  );

  useEffect(() => {
    let mounted = true;
    setRowsLoading(true);
    fetchRows(page, PAGE_SIZE)
      .then((result) => {
        if (!mounted) return;
        setRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      })
      .finally(() => mounted && setRowsLoading(false));
    return () => {
      mounted = false;
    };
  }, [fetchRows, page]);

  const columns = useMemo(() => {
    if (tab === "jobs") return JOB_COLUMNS;
    if (tab === "employers") return EMPLOYER_COLUMNS;
    return APPLICANT_COLUMNS;
  }, [tab]);

  const chartData = useMemo(
    () =>
      MONTH_LABELS.map((month, index) => ({
        month,
        applications: Number(analytics.applicationsThisMonth?.[index] || 0),
        registrations: Number(analytics.registrationsThisMonth?.[index] || 0),
      })),
    [analytics],
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

  const kpis = useMemo(
    () => [
      { key: "totalAccounts", label: t("admin.kpi.totalAccounts"), value: analytics.totalAccounts, icon: <Users size={20} /> },
      { key: "employers", label: t("admin.kpi.employers"), value: analytics.totalEmployers, icon: <Building2 size={20} /> },
      { key: "jobSeekers", label: t("admin.kpi.jobSeekers"), value: analytics.totalJobSeekers, icon: <UserRound size={20} /> },
      { key: "vacancies", label: t("admin.kpi.vacancies"), value: analytics.totalVacancies, icon: <BriefcaseBusiness size={20} /> },
      { key: "applications", label: t("admin.kpi.applications"), value: analytics.totalApplications, icon: <FileText size={20} /> },
      { key: "activeJobs", label: t("admin.kpi.activeJobs"), value: analytics.activeJobs, icon: <CircleCheck size={20} /> },
      { key: "closedJobs", label: t("admin.kpi.closedJobs"), value: analytics.closedJobs, icon: <Archive size={20} /> },
      { key: "verifiedEmployers", label: t("admin.kpi.verifiedEmployers"), value: analytics.verifiedEmployers, icon: <ShieldCheck size={20} /> },
    ],
    [analytics, t],
  );

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const selectTab = (key) => {
    setTab(key);
    setPage(1);
  };

  const activeFilterPairs = useMemo(() => {
    const pairs = [{ label: "Search", value: filters.search }];
    if (tab === "jobs") {
      pairs.push(
        { label: "Municipality", value: filters.municipality === "All Marinduque" ? "" : filters.municipality },
        { label: "Status", value: filters.jobStatus === "all" ? "" : filters.jobStatus },
      );
    } else {
      pairs.push({ label: "Status", value: filters.userStatus === "All" ? "" : filters.userStatus });
      if (tab === "employers") {
        pairs.push({ label: "Verification", value: filters.verification === "All" ? "" : filters.verification });
      }
    }
    return pairs;
  }, [tab, filters]);

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const result = await fetchRows(1, EXPORT_LIMIT);
      const stamp = new Date().toISOString().slice(0, 10);
      exportCsv({ filename: `report-${tab}-${stamp}.csv`, columns: exportable(columns), rows: result.rows });
      if (result.total > result.rows.length) toast.info(t("admin.reports.exportTruncated", { shown: result.rows.length, total: result.total }));
    } catch {
      toast.error(t("admin.reports.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExporting(true);
      const result = await fetchRows(1, EXPORT_LIMIT);
      const stamp = new Date().toISOString().slice(0, 10);
      exportPdfTable({
        title: TAB_TITLES[tab],
        filters: activeFilterPairs,
        columns: exportable(columns),
        rows: result.rows,
        filename: `report-${tab}-${stamp}.pdf`,
      });
      if (result.total > result.rows.length) toast.info(t("admin.reports.exportTruncated", { shown: result.rows.length, total: result.total }));
    } catch (error) {
      console.error("Failed to export PDF report", error);
      toast.error(t("admin.reports.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-page-container rpt-scope">
      <AdminHeader
        title="Reports & Statistics"
        description="Overall platform statistics plus filterable, exportable lists of applicants, jobs, and employers."
      />

      <AnalyticsStatsPanel />

      <section className="admin-kpis rpt-kpis" aria-label={t("admin.kpi.sectionLabel")}>
        {analyticsLoading ? (
          <div className="ds-metrics ds-metrics--4 admin-metrics" role="status" aria-label={t("common.loading")}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="ds-metric admin-metric--skeleton" aria-hidden="true">
                <span className="ds-skeleton admin-metric__skel-icon" />
                <span className="ds-skeleton admin-metric__skel-value" />
                <span className="ds-skeleton admin-metric__skel-label" />
              </div>
            ))}
          </div>
        ) : (
          <Reveal className="ds-metrics ds-metrics--4 admin-metrics">
            {kpis.map((item) => (
              <MetricCard key={item.key} icon={item.icon} value={item.value} label={item.label} />
            ))}
          </Reveal>
        )}
      </section>

      <section className="admin-analytics-grid">
        <article className="admin-panel-card admin-chart-card">
          <div className="admin-card-header">
            <h2 className="admin-chart-title"><ChartLine size={18} aria-hidden="true" /> {t("admin.charts.trendTitle")}</h2>
          </div>
          <div className="admin-chart-wrap" role="img" aria-label={t("admin.charts.trendAria")}>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rptRegistrationsArea" x1="0" y1="0" x2="0" y2="1">
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
                <Area type="monotone" dataKey="registrations" stroke="none" fill="url(#rptRegistrationsArea)" isAnimationActive={!reduced} />
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

      <section className="rpt-records">
        <div className="rpt-records__head">
          <div className="rpt-tabs ds-tabs" role="tablist" aria-label={t("admin.reports.tabsLabel")}>
            {TABS.map((entry) => (
              <button
                key={entry.key}
                id={`rpt-tab-${entry.key}`}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                aria-controls="rpt-panel"
                className={`rpt-tab ds-tab${tab === entry.key ? " is-active" : ""}`}
                onClick={() => selectTab(entry.key)}
              >
                {entry.icon} {entry.label}
              </button>
            ))}
          </div>
          <div className="rpt-export-group">
            <button
              type="button"
              className="rpt-export"
              onClick={handleExportCsv}
              disabled={exporting || rowsLoading || rows.length === 0}
            >
              <FaDownload /> {exporting ? "Preparing…" : "Export CSV"}
            </button>
            <button
              type="button"
              className="rpt-export rpt-export--pdf"
              onClick={handleExportPdf}
              disabled={exporting || rowsLoading || rows.length === 0}
            >
              <FaFileAlt /> {exporting ? "Preparing…" : "Export PDF"}
            </button>
          </div>
        </div>

        <div id="rpt-panel" role="tabpanel" aria-labelledby={`rpt-tab-${tab}`} className="rpt-panel">
        <div className="rpt-filters ds-toolbar">
          <input
            type="search"
            className="rpt-input"
            aria-label={t("admin.reports.searchLabel")}
            placeholder={tab === "jobs" ? "Search job title, employer, category" : "Search name or email"}
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
          />

          {tab === "jobs" ? (
            <>
              <select className="rpt-input" aria-label={t("admin.reports.municipalityLabel")} value={filters.municipality} onChange={(e) => setFilter("municipality", e.target.value)}>
                {MUNICIPALITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <select className="rpt-input" aria-label={t("admin.reports.statusLabel")} value={filters.jobStatus} onChange={(e) => setFilter("jobStatus", e.target.value)}>
                {JOB_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <select className="rpt-input" aria-label={t("admin.reports.statusLabel")} value={filters.userStatus} onChange={(e) => setFilter("userStatus", e.target.value)}>
                {USER_STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt === "All" ? "All statuses" : opt}</option>
                ))}
              </select>
              {tab === "employers" ? (
                <select className="rpt-input" aria-label={t("admin.reports.verificationLabel")} value={filters.verification} onChange={(e) => setFilter("verification", e.target.value)}>
                  {VERIFICATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt === "All" ? "All verification" : opt}</option>
                  ))}
                </select>
              ) : null}
            </>
          )}
        </div>

        <div className="rpt-table-wrap ds-table-wrap" aria-busy={rowsLoading}>
          <table className="rpt-table ds-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} scope="col" className={NUMERIC_COLUMNS.has(col.key) ? "is-num" : undefined}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsLoading ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="rpt-row--skeleton" aria-hidden="true">
                    {columns.map((col) => (
                      <td key={col.key}><span className="rpt-skel" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr className="rpt-row--empty">
                  <td colSpan={columns.length} className="rpt-empty">
                    <StateBlock
                      kind="empty"
                      title={t("admin.reports.emptyTitle")}
                      description={t("admin.reports.emptyDescription")}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row._id}>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        data-label={col.label}
                        className={NUMERIC_COLUMNS.has(col.key) ? "is-num" : undefined}
                      >
                        {col.get(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rpt-pagination">
          <span className="rpt-pagination__count">
            {total} record{total === 1 ? "" : "s"}
          </span>
          <div className="rpt-pagination__nav">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || rowsLoading}>
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || rowsLoading}
            >
              Next
            </button>
          </div>
        </div>
        </div>
      </section>
    </div>
  );
}
