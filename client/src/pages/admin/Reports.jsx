import { useCallback, useEffect, useMemo, useState } from "react";
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
  FaChartLine,
  FaDownload,
  FaFileAlt,
  FaShieldAlt,
  FaUser,
  FaUsers,
} from "react-icons/fa";
import { adminAPI } from "../../services/api";
import "../../styles/admin.css";
import "../../styles/reports.css";
import AdminHeader from "./AdminHeader";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TREND_COLORS = { applications: "#10b981", registrations: "#065f46" };
const CHART_AXIS = "#64748b";
const CHART_GRID = "#e5e7eb";
const CHART_TOOLTIP = { borderRadius: 10, border: "1px solid #e5e7eb", background: "#ffffff" };
const STATUS_COLORS = {
  pending: "#f59e0b",
  reviewed: "#3b82f6",
  shortlisted: "#8b5cf6",
  rejected: "#ef4444",
  hired: "#22c55e",
};

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

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadCsv = (filename, columns, rows) => {
  const header = columns.map((col) => csvCell(col.label)).join(",");
  const body = rows.map((row) => columns.map((col) => csvCell(col.get(row))).join(",")).join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
      const role = tab === "employers" ? "employer" : "resident";
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
      { label: "Total Accounts", value: analytics.totalAccounts, icon: <FaUsers />, color: "#22c55e", bg: "#dcfce7" },
      { label: "Employers", value: analytics.totalEmployers, icon: <FaBuilding />, color: "#3b82f6", bg: "#dbeafe" },
      { label: "Job Seekers", value: analytics.totalJobSeekers, icon: <FaUser />, color: "#8b5cf6", bg: "#ede9fe" },
      { label: "Vacancies", value: analytics.totalVacancies, icon: <FaBriefcase />, color: "#f59e0b", bg: "#fef3c7" },
      { label: "Applications", value: analytics.totalApplications, icon: <FaFileAlt />, color: "#06b6d4", bg: "#cffafe" },
      { label: "Active Jobs", value: analytics.activeJobs, icon: <FaBriefcase />, color: "#10b981", bg: "#d1fae5" },
      { label: "Closed Jobs", value: analytics.closedJobs, icon: <FaBriefcase />, color: "#64748b", bg: "#e2e8f0" },
      { label: "Verified Employers", value: analytics.verifiedEmployers, icon: <FaShieldAlt />, color: "#16a34a", bg: "#dcfce7" },
    ],
    [analytics],
  );

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const selectTab = (key) => {
    setTab(key);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const result = await fetchRows(1, EXPORT_LIMIT);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`report-${tab}-${stamp}.csv`, columns, result.rows);
    } catch (error) {
      /* no-op: export failure leaves the table intact */
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

      <section className="admin-stat-row rpt-kpis">
        {analyticsLoading
          ? Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="admin-stat-card admin-stat-card--skeleton">
                <div className="admin-stat-icon skeleton-box" />
                <div className="skeleton-line w-32" />
                <div className="skeleton-line w-24" />
              </div>
            ))
          : kpis.map((item) => (
              <article key={item.label} className="admin-stat-card" style={{ borderLeftColor: item.color }}>
                <span className="admin-stat-icon" style={{ background: item.bg, color: item.color }}>{item.icon}</span>
                <strong>{item.value}</strong>
                <p>{item.label}</p>
              </article>
            ))}
      </section>

      <section className="admin-analytics-grid">
        <article className="admin-panel-card">
          <div className="admin-card-header">
            <h3><FaChartLine /> Applications &amp; Registrations</h3>
          </div>
          <div className="admin-chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rptRegistrationsArea" x1="0" y1="0" x2="0" y2="1">
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
                <Area type="monotone" dataKey="registrations" stroke="none" fill="url(#rptRegistrationsArea)" />
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

      <section className="rpt-records">
        <div className="rpt-records__head">
          <div className="rpt-tabs" role="tablist">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                className={`rpt-tab${tab === entry.key ? " is-active" : ""}`}
                onClick={() => selectTab(entry.key)}
              >
                {entry.icon} {entry.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rpt-export"
            onClick={handleExport}
            disabled={exporting || rowsLoading || rows.length === 0}
          >
            <FaDownload /> {exporting ? "Preparing…" : "Export CSV"}
          </button>
        </div>

        <div className="rpt-filters">
          <input
            type="search"
            className="rpt-input"
            placeholder={tab === "jobs" ? "Search job title, employer, category" : "Search name or email"}
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
          />

          {tab === "jobs" ? (
            <>
              <select className="rpt-input" value={filters.municipality} onChange={(e) => setFilter("municipality", e.target.value)}>
                {MUNICIPALITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <select className="rpt-input" value={filters.jobStatus} onChange={(e) => setFilter("jobStatus", e.target.value)}>
                {JOB_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <select className="rpt-input" value={filters.userStatus} onChange={(e) => setFilter("userStatus", e.target.value)}>
                {USER_STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt === "All" ? "All statuses" : opt}</option>
                ))}
              </select>
              {tab === "employers" ? (
                <select className="rpt-input" value={filters.verification} onChange={(e) => setFilter("verification", e.target.value)}>
                  {VERIFICATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt === "All" ? "All verification" : opt}</option>
                  ))}
                </select>
              ) : null}
            </>
          )}
        </div>

        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsLoading ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td key={col.key}><span className="rpt-skel" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="rpt-empty">No records match the current filters.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row._id}>
                    {columns.map((col) => (
                      <td key={col.key}>{col.get(row)}</td>
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
      </section>
    </div>
  );
}
