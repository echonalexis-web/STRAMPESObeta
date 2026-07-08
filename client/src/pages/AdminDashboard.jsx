import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AuthContext } from "../context/AuthContext";
import { adminAPI } from "../services/api";
import "../styles/admin.css";
import { 
  FaUsers, 
  FaBuilding, 
  FaUser, 
  FaBriefcase, 
  FaFileAlt, 
  FaCheckCircle, 
  FaSearch, 
  FaPlus, 
  FaCopy,
  FaTimes,
  FaEllipsisV,
  FaEye,
  FaUserCheck,
  FaUserSlash,
  FaTrash,
  FaShieldAlt,
  FaStar,
  FaChartLine,
  FaCalendarAlt,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaUserCircle
} from "react-icons/fa";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_COLORS = {
  pending: "#f59e0b",
  reviewed: "#3b82f6",
  shortlisted: "#8b5cf6",
  rejected: "#ef4444",
  hired: "#22c55e",
};

const TABS = [
  { label: "All Users", value: "" },
  { label: "Employers", value: "employer" },
  { label: "Job Seekers", value: "resident" },
  { label: "Admins", value: "admin" },
];

const PAGE_LIMIT = 10;

const formatDate = (value) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function ActionsMenu({ row, isBusy, onDeactivate, onReactivate, onDelete, onToggleVerification }) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [menuHeight, setMenuHeight] = useState(140);

  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const canManage = row.role !== "admin";
  const isActive = row.isActive !== false;

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const measuredHeight = menuRef.current?.offsetHeight || menuHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldOpenUpward = spaceBelow < measuredHeight + 12;

    setOpenUpward(shouldOpenUpward);

    const top = shouldOpenUpward
      ? Math.max(8, rect.top - measuredHeight - 4)
      : Math.min(window.innerHeight - measuredHeight - 8, rect.bottom + 4);

    const left = Math.max(8, rect.right - 200);

    setMenuPosition({ top, left });
  }, [menuHeight]);

  const handleToggle = () => {
    if (!open) {
      updateMenuPosition();
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return undefined;

    const rafId = requestAnimationFrame(() => {
      if (menuRef.current) {
        setMenuHeight(menuRef.current.offsetHeight || 140);
      }
      updateMenuPosition();
    });

    return () => cancelAnimationFrame(rafId);
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return undefined;

    const handleOutside = (event) => {
      const clickedMenu = menuRef.current?.contains(event.target);
      const clickedButton = buttonRef.current?.contains(event.target);

      if (!clickedMenu && !clickedButton) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) return undefined;

    const handleViewportChange = () => closeMenu();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, closeMenu]);

  return (
    <div className="admin-action-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="admin-action-trigger"
        onClick={handleToggle}
        disabled={isBusy}
      >
        <FaEllipsisV />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="admin-action-menu"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
            data-direction={openUpward ? "up" : "down"}
          >
            <button onClick={() => { closeMenu(); window.alert(`${row.name}\n${row.email}`); }}>
              <FaEye /> View Profile
            </button>

            {row.role === "employer" ? (
              <button onClick={() => { closeMenu(); onToggleVerification(); }}>
                <FaShieldAlt /> {row.verificationStatus === "verified" ? "Revoke Verification" : "Verify Employer"}
              </button>
            ) : null}

            {canManage ? (
              isActive ? (
                <button className="danger" onClick={() => { closeMenu(); onDeactivate(); }}>
                  <FaUserSlash /> Deactivate
                </button>
              ) : (
                <button onClick={() => { closeMenu(); onReactivate(); }}>
                  <FaUserCheck /> Reactivate
                </button>
              )
            ) : null}

            {canManage ? (
              <button className="danger" onClick={() => { closeMenu(); onDelete(); }}>
                <FaTrash /> Delete
              </button>
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  const [analytics, setAnalytics] = useState(null);
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  const [roleFilter, setRoleFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingHomepageJobs, setLoadingHomepageJobs] = useState(true);
  const [error, setError] = useState("");
  const [homepageJobsError, setHomepageJobsError] = useState("");

  const [verificationTarget, setVerificationTarget] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [busyJobId, setBusyJobId] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [homepageJobs, setHomepageJobs] = useState([]);
  const [rankedHomepageJobs, setRankedHomepageJobs] = useState([]);
  const [featuredCount, setFeaturedCount] = useState(0);

  useEffect(() => {
    if (user?.role !== "admin") {
      navigate("/");
    }
  }, [user, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [roleFilter, search, currentPage]);

  useEffect(() => {
    fetchHomepageJobs();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoadingAnalytics(true);
      const { data } = await adminAPI.getAnalytics();
      setAnalytics(data);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load analytics");
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const { data } = await adminAPI.getUsers({
        role: roleFilter || undefined,
        search: search || undefined,
        page: currentPage,
        limit: PAGE_LIMIT,
      });

      setUsers(Array.isArray(data.users) ? data.users : []);
      setTotalUsers(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
      setCurrentPage(Number(data.currentPage || 1));
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchHomepageJobs = async () => {
    try {
      setLoadingHomepageJobs(true);
      const { data } = await adminAPI.getHomepageJobManagement();
      setHomepageJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setRankedHomepageJobs(Array.isArray(data.rankedJobs) ? data.rankedJobs : []);
      setFeaturedCount(Number(data.featuredCount || 0));
      setHomepageJobsError("");
    } catch (err) {
      setHomepageJobsError(err.response?.data?.message || "Failed to load homepage job management");
    } finally {
      setLoadingHomepageJobs(false);
    }
  };

  const stats = useMemo(() => {
    if (!analytics) return [];

    return [
      { label: "Total Accounts", icon: <FaUsers />, value: analytics.totalAccounts, color: "#22c55e", bg: "#dcfce7" },
      { label: "Total Employers", icon: <FaBuilding />, value: analytics.totalEmployers, color: "#3b82f6", bg: "#dbeafe" },
      { label: "Job Seekers", icon: <FaUser />, value: analytics.totalJobSeekers, color: "#8b5cf6", bg: "#ede9fe" },
      { label: "Vacancies", icon: <FaBriefcase />, value: analytics.totalVacancies, color: "#f59e0b", bg: "#fef3c7" },
      { label: "Applications", icon: <FaFileAlt />, value: analytics.totalApplications, color: "#06b6d4", bg: "#cffafe" },
      { label: "Verified Employers", icon: <FaCheckCircle />, value: analytics.verifiedEmployers, color: "#22c55e", bg: "#dcfce7" },
    ];
  }, [analytics]);

  const chartData = useMemo(() => {
    if (!analytics) return [];

    const appSeries = Array.isArray(analytics.applicationsThisMonth) ? analytics.applicationsThisMonth : [];
    const regSeries = Array.isArray(analytics.registrationsThisMonth) ? analytics.registrationsThisMonth : [];

    return MONTH_LABELS.map((month, index) => ({
      month,
      applications: Number(appSeries[index] || 0),
      registrations: Number(regSeries[index] || 0),
    }));
  }, [analytics]);

  const pieData = useMemo(() => {
    const source = analytics?.applicationsByStatus || {};
    return [
      { key: "pending", name: "Pending", value: Number(source.pending || 0) },
      { key: "reviewed", name: "Reviewed", value: Number(source.reviewed || 0) },
      { key: "shortlisted", name: "Shortlisted", value: Number(source.shortlisted || 0) },
      { key: "rejected", name: "Rejected", value: Number(source.rejected || 0) },
      { key: "hired", name: "Hired", value: Number(source.hired || 0) },
    ];
  }, [analytics]);

  const roleBadgeClass = (role) => {
    if (role === "admin") return "admin-role-badge admin";
    if (role === "employer") return "admin-role-badge employer";
    return "admin-role-badge resident";
  };

  const runUserAction = async (request) => {
    try {
      await request();
      await Promise.all([fetchUsers(), fetchAnalytics()]);
      setVerificationTarget("");
    } catch (err) {
      setError(err.response?.data?.message || "Action failed");
    } finally {
      setBusyUserId("");
    }
  };

  const handleDeactivate = (targetUser) => {
    if (!window.confirm(`Deactivate ${targetUser.name}?`)) return;
    setBusyUserId(targetUser._id);
    runUserAction(() => adminAPI.deactivateUser(targetUser._id));
  };

  const handleReactivate = (targetUser) => {
    setBusyUserId(targetUser._id);
    runUserAction(() => adminAPI.reactivateUser(targetUser._id));
  };

  const handleDelete = (targetUser) => {
    if (!window.confirm(`Delete ${targetUser.name}? This cannot be undone.`)) return;
    setBusyUserId(targetUser._id);
    runUserAction(() => adminAPI.deleteUser(targetUser._id));
  };

  const handleVerification = (targetUser, verificationStatus) => {
    setBusyUserId(targetUser._id);
    runUserAction(() => adminAPI.updateEmployerVerification(targetUser._id, verificationStatus));
  };

  const handleGenerateInvite = async () => {
    try {
      const { data } = await adminAPI.generateInvite();
      setInviteCode(data.code || "");
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to generate invite code");
    }
  };

  const copyInviteCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      window.alert("Invite code copied to clipboard.");
    } catch {
      window.alert("Copy failed. Please copy manually.");
    }
  };

  const handleToggleHomepageFeature = async (jobId, nextValue) => {
    try {
      setBusyJobId(jobId);
      await adminAPI.toggleHomepageFeature(jobId, nextValue);
      await fetchHomepageJobs();
      await fetchAnalytics();
    } catch (err) {
      setHomepageJobsError(err.response?.data?.message || "Failed to update homepage feature");
    } finally {
      setBusyJobId("");
    }
  };

  const getEmployerDisplay = (job) => {
    if (!job?.employer || typeof job.employer !== "object") {
      return "Unknown employer";
    }
    return job.employer.companyName || job.employer.name || "Unknown employer";
  };

  return (
    <div className="admin-panel-page">
      {/* Banner */}
      <section className="admin-banner">
        <div className="admin-banner-content">
          <div>
            <h1>Admin Dashboard</h1>
            <p>Manage and monitor the STRAM PESO platform</p>
          </div>
          <div className="admin-banner-actions">
            <button className="admin-banner-btn" onClick={handleGenerateInvite}>
              <FaPlus /> Generate Invite
            </button>
          </div>
        </div>
      </section>

      {error && <div className="admin-error">{error}</div>}

      {/* Stats Grid */}
      <section className="admin-stats-grid">
        {(loadingAnalytics ? Array.from({ length: 6 }, (_, i) => ({ label: `Loading-${i}`, icon: <FaUser />, value: "--", color: "#94a3b8", bg: "#f1f5f9" })) : stats).map((item) => (
          <article key={item.label} className="admin-stat-card" style={{ borderLeftColor: item.color }}>
            <span className="admin-stat-icon" style={{ background: item.bg, color: item.color }}>{item.icon}</span>
            <strong>{item.value}</strong>
            <p>{item.label}</p>
          </article>
        ))}
      </section>

      {/* Charts */}
      <section className="admin-chart-grid">
        <article className="admin-chart-card">
          <div className="admin-chart-header">
            <h3><FaChartLine /> Applications &amp; Registrations</h3>
          </div>
          <div className="admin-chart-area">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" strokeDasharray="4 4" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" allowDecimals={false} fontSize={12} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  formatter={(value) => [`${value}`, '']}
                />
                <Legend verticalAlign="top" height={36} />
                <Bar dataKey="applications" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="registrations" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="admin-chart-card">
          <div className="admin-chart-header">
            <h3><FaChartLine /> Application Status</h3>
          </div>
          <div className="admin-chart-area admin-chart-area-pie">
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  formatter={(value) => [`${value} applications`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="admin-pie-legend">
              {pieData.map((entry) => (
                <div key={entry.key} className="admin-pie-legend-item">
                  <span className="swatch" style={{ background: STATUS_COLORS[entry.key] }}></span>
                  <span>{entry.name}</span>
                  <strong>{entry.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      {/* Homepage Management */}
      <section className="admin-homepage-section">
        <div className="admin-homepage-header">
          <div>
            <h2><FaStar /> Homepage Featured Jobs</h2>
            <p>Manage featured jobs displayed on the public homepage</p>
          </div>
          <div className="admin-featured-count">
            <FaStar className="star-icon" />
            <span><strong>{featuredCount}</strong> / 4 slots used</span>
          </div>
        </div>

        {homepageJobsError && <div className="admin-error admin-error-small">{homepageJobsError}</div>}

        <div className="admin-homepage-grid">
          <article className="admin-homepage-card admin-homepage-card--jobs">
            <div className="admin-card-header">
              <h3>All Active Jobs</h3>
            </div>

            {loadingHomepageJobs ? (
              <p className="admin-loading">Loading jobs...</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Job Title</th>
                      <th>Employer</th>
                      <th>Posted</th>
                      <th>Applications</th>
                      <th>Featured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {homepageJobs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="admin-empty-state">
                          <FaBriefcase className="empty-icon" />
                          <p>No active job postings found.</p>
                        </td>
                      </tr>
                    ) : (
                      homepageJobs.map((job) => {
                        const isFeatured = Boolean(job.isFeatured);
                        const isBusy = busyJobId === job._id;

                        return (
                          <tr key={job._id}>
                            <td><strong>{job.title}</strong></td>
                            <td>{getEmployerDisplay(job)}</td>
                            <td>{formatDate(job.createdAt)}</td>
                            <td>{Number(job.applicationCount || 0)}</td>
                            <td>
                              <label className="admin-toggle">
                                <input
                                  type="checkbox"
                                  checked={isFeatured}
                                  disabled={isBusy || (!isFeatured && featuredCount >= 4)}
                                  onChange={(event) => handleToggleHomepageFeature(job._id, event.target.checked)}
                                />
                                <span className={isFeatured ? "active" : ""}>
                                  {isFeatured ? "★ Featured" : "Add"}
                                </span>
                              </label>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="admin-homepage-card admin-homepage-card--analytics">
            <div className="admin-card-header">
              <h3>📊 Top Performing Jobs</h3>
            </div>
            {loadingHomepageJobs ? (
              <p className="admin-loading">Loading analytics...</p>
            ) : rankedHomepageJobs.length === 0 ? (
              <div className="admin-empty-state">
                <FaChartLine className="empty-icon" />
                <p>No application data available yet.</p>
              </div>
            ) : (
              <div className="admin-rank-list">
                {rankedHomepageJobs.slice(0, 8).map((job, index) => (
                  <div key={job._id} className="admin-rank-item">
                    <div className="admin-rank-number">#{index + 1}</div>
                    <div className="admin-rank-info">
                      <strong>{job.title}</strong>
                      <span>{getEmployerDisplay(job)}</span>
                    </div>
                    <div className="admin-rank-count">{Number(job.applicationCount || 0)}</div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      {/* User Management */}
      <section className="admin-users-section">
        <div className="admin-users-header">
          <div>
            <h2><FaUsers /> User Management</h2>
            <p>Monitor and manage all system accounts</p>
          </div>
        </div>

        <div className="admin-users-toolbar">
          <div className="admin-search-wrapper">
            <FaSearch className="admin-search-icon" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <button className="admin-invite-btn" onClick={handleGenerateInvite}>
            <FaPlus /> Generate Invite
          </button>
        </div>

        <div className="admin-users-meta">
          <div className="admin-tab-filters">
            {TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                className={roleFilter === tab.value ? "active" : ""}
                onClick={() => { setRoleFilter(tab.value); setCurrentPage(1); }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="admin-user-count">Showing {users.length} of {totalUsers} users</p>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="admin-actions-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loadingUsers && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-empty-state">
                    <FaSearch className="empty-icon" />
                    <p>No users found matching your search.</p>
                  </td>
                </tr>
              ) : (
                users.map((row) => {
                  const isActive = row.isActive !== false;
                  const canManage = row.role !== "admin";
                  const isBusy = busyUserId === row._id;

                  return (
                    <Fragment key={row._id}>
                      <tr>
                        <td>
                          <div className="admin-user-cell">
                            <div className="admin-user-avatar">
                              {String(row.name || "U").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <strong>{row.name}</strong>
                              <small>{row.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={roleBadgeClass(row.role)}>{row.role}</span>
                        </td>
                        <td>
                          <span className={`admin-status-badge ${isActive ? "active" : "inactive"}`}>
                            {isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>{formatDate(row.createdAt)}</td>
                        <td>
                          <ActionsMenu
                            row={row}
                            isBusy={isBusy}
                            onDeactivate={() => handleDeactivate(row)}
                            onReactivate={() => handleReactivate(row)}
                            onDelete={() => handleDelete(row)}
                            onToggleVerification={() =>
                              setVerificationTarget(verificationTarget === row._id ? "" : row._id)
                            }
                          />
                        </td>
                      </tr>

                      {verificationTarget === row._id && row.role === "employer" ? (
                        <tr>
                          <td colSpan={5} className="admin-verification-row">
                            <div className="admin-verification-inline">
                              <p>Set verification status for <strong>{row.name}</strong>:</p>
                              <div>
                                <button onClick={() => handleVerification(row, "unverified")}>Unverified</button>
                                <button onClick={() => handleVerification(row, "pending")}>Pending</button>
                                <button className="verified" onClick={() => handleVerification(row, "verified")}>
                                  ✓ Verified
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-pagination">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
            disabled={currentPage <= 1}
          >
            ← Previous
          </button>
          <p>Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong></p>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
            disabled={currentPage >= totalPages}
          >
            Next →
          </button>
        </div>
      </section>

      {/* Invite Modal */}
      {inviteCode && (
        <div className="admin-invite-overlay" onClick={() => setInviteCode("")}>
          <div className="admin-invite-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-invite-close" onClick={() => setInviteCode("")}>
              <FaTimes />
            </button>
            <h3>🔑 Employer Invite Code</h3>
            <p>Share this code with employers to register</p>
            <div className="admin-invite-code">{inviteCode}</div>
            <div className="admin-invite-actions">
              <button className="admin-invite-copy" onClick={copyInviteCode}>
                <FaCopy /> Copy
              </button>
              <button className="admin-invite-close-btn" onClick={() => setInviteCode("")}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}