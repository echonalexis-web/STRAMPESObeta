import { useEffect, useMemo, useState } from "react";
import {
  FaBriefcase,
  FaCheck,
  FaCheckCircle,
  FaChevronDown,
  FaClock,
  FaDownload,
  FaExclamationTriangle,
  FaEye,
  FaMapMarkerAlt,
  FaPlus,
  FaSearch,
  FaTimes,
  FaUsers,
} from "react-icons/fa";
import { adminAPI } from "../../services/api";
import "../../styles/jobMonitoring.css";
import { normalizeJobMonitoringRecord } from "../../data/jobMonitoringData";

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

const STATUS_OPTIONS = [
  "All Statuses",
  "Pending Review",
  "Active",
  "Closed / Filled",
  "Rejected",
];

const STATUS_META = {
  active: { label: "Active", cls: "jm-badge jm-badge--active" },
  pending: { label: "Pending", cls: "jm-badge jm-badge--pending" },
  urgent: { label: "Urgent", cls: "jm-badge jm-badge--urgent" },
  closed: { label: "Closed", cls: "jm-badge jm-badge--closed" },
};

export default function JobMonitoring() {
  const PAGE_SIZE = 10;

  const [jobs, setJobs] = useState([]);
  const [statsData, setStatsData] = useState(null);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMunicipality, setSelectedMunicipality] = useState("All Marinduque");
  const [selectedStatus, setSelectedStatus] = useState("All Statuses");
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedMunicipality, selectedStatus]);

  useEffect(() => {
    let isMounted = true;

    const loadJobs = async () => {
      try {
        setLoading(true);

        const { data } = await adminAPI.getAdminVacancies({
          page: currentPage,
          limit: PAGE_SIZE,
          search: searchTerm,
          municipality: selectedMunicipality === "All Marinduque" ? "all" : selectedMunicipality,
          status: selectedStatus === "All Statuses" ? "all" : selectedStatus,
        });

        if (!isMounted) return;

        const normalizedJobs = Array.isArray(data?.jobs)
          ? data.jobs.map(normalizeJobMonitoringRecord)
          : [];

        setJobs(normalizedJobs);
        setTotalPages(data?.totalPages || 1);
        setTotalJobs(data?.total || 0);
      } catch (error) {
        if (isMounted) {
          setJobs([]);
          setTotalPages(1);
          setTotalJobs(0);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadJobs();

    return () => {
      isMounted = false;
    };
  }, [currentPage, searchTerm, selectedMunicipality, selectedStatus]);

  useEffect(() => {
    let isMounted = true;

    const loadStats = async () => {
      try {
        const { data } = await adminAPI.getAdminVacancyStats({
          search: searchTerm,
          municipality: selectedMunicipality === "All Marinduque" ? "all" : selectedMunicipality,
          status: selectedStatus === "All Statuses" ? "all" : selectedStatus,
        });

        if (isMounted) setStatsData(data || null);
      } catch (error) {
        if (isMounted) setStatsData(null);
      }
    };

    loadStats();

    return () => {
      isMounted = false;
    };
  }, [searchTerm, selectedMunicipality, selectedStatus, statsRefreshKey]);

  const provinceSummary = useMemo(() => {
    const breakdown = Array.isArray(statsData?.municipalityBreakdown)
      ? statsData.municipalityBreakdown
      : [];
    const breakdownMap = new Map(breakdown.map((item) => [item.label, item]));

    const fallbackMap = new Map();
    jobs.forEach((job) => {
      const municipality = job.municipality || "Other / Outside Province";
      const current = fallbackMap.get(municipality) || { jobs: 0, slots: 0 };
      current.jobs += 1;
      current.slots += Number(job.slots || 0);
      fallbackMap.set(municipality, current);
    });

    const summary = [
      "Boac (Capital)",
      "Santa Cruz",
      "Gasan",
      "Mogpog",
      "Torrijos",
      "Buenavista",
      "Other / Outside Province",
    ].map((municipality) => {
      const entry = breakdownMap.get(municipality) || fallbackMap.get(municipality) || {};
      const slots = Number(entry.slots || 0);
      const jobsCount = Number(entry.jobs || 0);
      return {
        label: municipality,
        jobs: jobsCount,
        value: slots || jobsCount,
      };
    });

    return summary.filter((item) => item.value > 0 || item.jobs > 0);
  }, [statsData, jobs]);

  const stats = useMemo(() => {
    const totals = statsData?.totals || {};
    const pickNumber = (primary, fallback) =>
      typeof primary === "number" && Number.isFinite(primary) ? primary : fallback;

    const totalPostings = pickNumber(totals.totalPostings, totalJobs || jobs.length);
    const pendingApprovals = pickNumber(
      totals.pending,
      jobs.filter((job) => ["pending", "urgent"].includes(job.status)).length,
    );
    const activeVacancies = pickNumber(
      totals.active,
      jobs.filter((job) => job.status === "active").length,
    );
    const totalOpenSlots = pickNumber(
      totals.totalSlots,
      jobs.reduce((sum, job) => sum + Number(job.slots || 0), 0),
    );
    const applications = pickNumber(
      totals.applications,
      jobs.reduce((sum, job) => sum + Number(job.applicants || 0), 0),
    );
    const closedJobs = pickNumber(
      totals.closed,
      jobs.filter((job) => job.status === "closed").length,
    );

    return [
      { label: "Total Postings", value: totalPostings, sub: "Across all sectors", accent: "blue", icon: FaBriefcase },
      { label: "Active", value: activeVacancies, sub: "Live on portal", accent: "green", icon: FaCheckCircle },
      { label: "Pending", value: pendingApprovals, sub: "Needs PESO approval", accent: "amber", icon: FaClock },
      { label: "Total Slots", value: totalOpenSlots, sub: "Across active listings", accent: "purple", icon: FaUsers },
      { label: "Applications", value: applications, sub: "Submitted by jobseekers", accent: "teal", icon: FaBriefcase },
      { label: "Closed Jobs", value: closedJobs, sub: "Filled / Expired", accent: "gray", icon: FaCheck },
    ];
  }, [statsData, jobs, totalJobs]);

  const maxChartValue = Math.max(...provinceSummary.map((item) => item.value), 1);

  const handleStatusUpdate = async (jobId, nextStatus) => {
    try {
      await adminAPI.updateJobStatus(jobId, nextStatus);
      setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: nextStatus } : job)));
      setStatsRefreshKey((key) => key + 1);
    } catch (error) {
      console.error("Failed to update job status", error);
    } finally {
      setSelectedJob(null);
    }
  };

  return (
    <div className="jm-page">
      <header className="jm-banner">
        <div className="jm-banner__rings" aria-hidden="true" />
        <div className="jm-banner__eyebrow">Admin Control Center</div>
        <h1 className="jm-banner__title">Job Monitoring &amp; Vacancy Pipeline</h1>
        <p className="jm-banner__desc">
          Monitor employer job postings, review pending vacancies, track hiring demand across Marinduque
          municipalities, and verify slot allocations in real-time.
        </p>
      </header>

      <section className="jm-kpi-grid">
        {stats.map(({ label, value, sub, accent, icon: Icon }) => (
          <article key={label} className={`jm-kpi jm-kpi--${accent}`}>
            <div className="jm-kpi__header">
              <span className="jm-kpi__label">{label}</span>
              <div className="jm-kpi__icon">
                <Icon />
              </div>
            </div>
            <div className="jm-kpi__value">{value}</div>
            <div className="jm-kpi__sub">{sub}</div>
          </article>
        ))}
      </section>

      <section className="jm-panel">
        <div className="jm-panel__head">
          <h2 className="jm-panel__title">Job Vacancies &amp; Slot Openings by Municipality</h2>
          <div className="jm-province-pill">Marinduque Province</div>
        </div>

        {provinceSummary.length === 0 ? (
          <div className="jm-chart jm-chart--empty">
            No slot openings match the current filters.
          </div>
        ) : (
          <div
            className="jm-chart"
            role="img"
            aria-label={`Slot openings by municipality: ${provinceSummary
              .map((item) => `${item.label} ${item.value}`)
              .join(", ")}`}
          >
            {provinceSummary.map((item) => (
              <div key={item.label} className="jm-chart__column">
                <div className="jm-chart__value">{item.value}</div>
                <div className="jm-chart__track">
                  <div
                    className="jm-chart__bar"
                    style={{ height: `${Math.max((item.value / maxChartValue) * 100, 3)}%` }}
                  />
                </div>
                <div className="jm-chart__label">{item.label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="jm-panel">
        <div className="jm-panel__head jm-panel__head--directory">
          <h2 className="jm-panel__title">Job Vacancy Directory</h2>
          <div className="jm-directory-actions">
            <button type="button" className="jm-btn jm-btn--ghost">
              <FaDownload />
              <span>Export CSV</span>
            </button>
            <button type="button" className="jm-btn jm-btn--primary">
              <FaPlus />
              <span>Post PESO Listing</span>
            </button>
          </div>
        </div>

        <div className="jm-filters">
          <div className="jm-field">
            <label className="jm-field__label" htmlFor="job-monitoring-search">Search vacancy / employer</label>
            <div className="jm-field__wrap">
              <FaSearch className="jm-field__icon" />
              <input
                id="job-monitoring-search"
                type="text"
                placeholder="Search title, employer, or category"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>

          <div className="jm-field">
            <label className="jm-field__label" htmlFor="municipality-select">Municipality</label>
            <div className="jm-field__wrap jm-field__wrap--select">
              <select id="municipality-select" value={selectedMunicipality} onChange={(event) => setSelectedMunicipality(event.target.value)}>
                {MUNICIPALITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <FaChevronDown className="jm-field__chevron" />
            </div>
          </div>

          <div className="jm-field">
            <label className="jm-field__label" htmlFor="status-select">Approval / Status</label>
            <div className="jm-field__wrap jm-field__wrap--select">
              <select id="status-select" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <FaChevronDown className="jm-field__chevron" />
            </div>
          </div>
        </div>

        <div className="jm-table-wrap">
          <table className="jm-table">
            <thead>
              <tr>
                <th>Job title &amp; ID</th>
                <th>Employer</th>
                <th>Location</th>
                <th>Slots &amp; applicants</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="jm-empty">
                    <FaExclamationTriangle aria-hidden="true" />
                    Loading active vacancies...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="jm-empty">
                    <FaExclamationTriangle aria-hidden="true" />
                    No vacancies match your filters.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const badge = STATUS_META[job.status] || STATUS_META.pending;

                  return (
                    <tr key={job.id}>
                      <td>
                        <div className="jm-job-cell">
                          <div className="jm-job-title">{job.title}</div>
                          <div className="jm-job-row">
                            <span className="jm-job-id">{job.id}</span>
                            <span className="jm-type-pill">{job.type}</span>
                            <span className={badge.cls}>{badge.label}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="jm-employer-cell">
                          <div className="jm-employer">{job.employer}</div>
                          <div className="jm-category">{job.category}</div>
                        </div>
                      </td>
                      <td>
                        <div className="jm-location-cell">
                          <span className="jm-location-dot" />
                          <div>
                            <div className="jm-location__name">{job.municipality}</div>
                            <div className="jm-location__salary">{job.salary}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="jm-slot-cell">
                          <div className="jm-slot-row">
                            <span className="jm-slots__ratio">{job.slots} / {job.applicants} slots</span>
                            <button type="button" className="jm-view-btn" onClick={() => setSelectedJob(job)}>
                              <FaEye />
                            </button>
                          </div>
                          <div className="jm-slots__meta">{job.applicants} applicants</div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="jm-pagination">
          <button
            type="button"
            className="jm-btn jm-btn--ghost"
            disabled={currentPage === 1 || loading}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          >
            Previous
          </button>

          <span className="jm-pagination__info">
            Page {currentPage} of {totalPages}
          </span>

          <button
            type="button"
            className="jm-btn jm-btn--primary"
            disabled={currentPage >= totalPages || loading}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          >
            Next
          </button>
        </div>
      </section>

      {selectedJob ? (
        <div className="jm-backdrop" onClick={() => setSelectedJob(null)}>
          <div className="jm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="jm-modal__header">
              <div className="jm-modal__icon">
                <FaBriefcase />
              </div>
              <div className="jm-modal__heading">
                <p className="jm-modal__eyebrow">Vacancy Inspection</p>
                <h3 className="jm-modal__title">{selectedJob.title}</h3>
              </div>
              <button type="button" className="jm-modal__close" onClick={() => setSelectedJob(null)} aria-label="Close vacancy inspection">
                <FaTimes />
              </button>
            </div>

            <div className="jm-modal__body">
              <div className="jm-modal__grid">
                <div className="jm-modal__card">
                  <h4>Job Summary</h4>
                  <p>{selectedJob.description}</p>
                </div>
                <div className="jm-modal__card">
                  <h4>Employer</h4>
                  <p><strong>{selectedJob.employer}</strong></p>
                  <p className="jm-modal__detail"><FaMapMarkerAlt aria-hidden="true" /> {selectedJob.municipality}</p>
                  <p>{selectedJob.salary}</p>
                </div>
              </div>

              <div className="jm-modal__grid jm-modal__grid--narrow">
                <div className="jm-modal__card">
                  <h4>Required Skills</h4>
                  <div className="jm-skill-list">
                    {selectedJob.qualifications.map((skill) => (
                      <span className="jm-skill-tag" key={skill}>{skill}</span>
                    ))}
                  </div>
                </div>
                <div className="jm-modal__card">
                  <h4>Quick Actions</h4>
                  <div className="jm-modal__actions">
                    <button type="button" className="jm-btn jm-btn--approve" onClick={() => handleStatusUpdate(selectedJob.id, "active")}>
                      <FaCheck aria-hidden="true" /> Approve listing
                    </button>
                    <button type="button" className="jm-btn jm-btn--reject" onClick={() => handleStatusUpdate(selectedJob.id, "closed")}>
                      <FaTimes aria-hidden="true" /> Reject listing
                    </button>
                    <button type="button" className="jm-btn jm-btn--ghost" onClick={() => setSelectedJob(null)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
