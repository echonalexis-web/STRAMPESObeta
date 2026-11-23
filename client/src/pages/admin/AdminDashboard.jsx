import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BriefcaseBusiness, Building2, ChevronRight, ClipboardCheck, UserRound, Users } from "lucide-react";
import { adminAPI } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import AdminHeader from "./AdminHeader";
import MetricCard from "../../components/MetricCard";
import StateBlock from "../../components/StateBlock";
import "../../styles/admin.css";
import "../../styles/admin-overview.css";

// Where each "needs attention" row goes. Every target is an existing route with its own guard.
const ATTENTION_LINKS = {
  employerVerification: "/admin/verification",
  moderation: "/admin/users/moderation",
  accountRecovery: "/admin/account-recovery",
  closingSoon: "/admin/job-monitoring",
  hiddenByEmployer: "/admin/job-monitoring",
};

// An audit action key shown as plain words: "employer.verification.approved" -> "Employer verification approved".
const actionText = (action) => {
  const words = String(action || "").replace(/[._-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};

const dateText = (value, language) => {
  try {
    return new Intl.DateTimeFormat(language === "fil" ? "fil-PH" : "en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
  } catch {
    return "";
  }
};

export default function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const [state, setState] = useState({ key: null, data: null, failed: null });
  const [attempt, setAttempt] = useState(0);
  const key = `dashboard#${attempt}`;

  useEffect(() => {
    let live = true;
    adminAPI
      .getDashboardOverview()
      .then(({ data }) => live && setState({ key, data, failed: null }))
      .catch(() => live && setState({ key, data: null, failed: key }));
    return () => {
      live = false;
    };
  }, [key]);

  const failed = state.failed === key;
  const data = state.key === key ? state.data : null;
  const kpis = data?.kpis;
  const maxMunicipality = Math.max(1, ...(data?.jobseekersByMunicipality || []).map((row) => row.value || 0));

  const attentionText = (row) => {
    const base = `adminDash.attention.rows.${row.key}`;
    if (row.count === 0) return t(`${base}.hintNone`);
    if (row.key === "employerVerification") return t(`${base}.hint`, { days: row.oldestDays ?? 0 });
    if (row.key === "moderation") return t(`${base}.hint`, { reports: row.reports, appeals: row.appeals });
    return t(`${base}.hint`);
  };

  return (
    <div className="admin-page-container ov">
      <AdminHeader title={t("adminDash.title")} description={t("adminDash.description")} />

      {failed ? (
        <StateBlock kind="error" title={t("adminAnalytics.errors.title")} description={t("adminAnalytics.errors.text")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : (
        <>
          <section aria-label={t("adminDash.kpiLabel")} className="ds-metrics ds-metrics--4 ov__kpis">
            <MetricCard
              icon={<Users size={20} />}
              value={kpis.activeJobseekers.value}
              label={t("adminDash.kpis.activeJobseekers.label")}
              note={t("adminDash.kpis.activeJobseekers.note", { count: kpis.activeJobseekers.joinedLast30 })}
            />
            <MetricCard
              icon={<Building2 size={20} />}
              value={t("adminDash.kpis.verifiedEmployers.value", { verified: kpis.verifiedEmployers.verified, total: kpis.verifiedEmployers.total })}
              label={t("adminDash.kpis.verifiedEmployers.label")}
              note={t("adminDash.kpis.verifiedEmployers.note", { count: kpis.verifiedEmployers.pending })}
            />
            <MetricCard
              icon={<BriefcaseBusiness size={20} />}
              value={kpis.openVacancies.value}
              label={t("adminDash.kpis.openVacancies.label")}
              note={t("adminDash.kpis.openVacancies.note", { count: kpis.openVacancies.closingSoon })}
            />
            <MetricCard
              icon={<ClipboardCheck size={20} />}
              value={kpis.applicationsToReview.value}
              label={t("adminDash.kpis.applicationsToReview.label")}
              note={t("adminDash.kpis.applicationsToReview.note")}
            />
          </section>

          <div className="ov__main">
            <div className="ov__col">
              <section className="ov__card" aria-labelledby="ov-attention-title">
              <h2 id="ov-attention-title" className="ov__h2">{t("adminDash.attention.title")}</h2>
              <p className="ov__sub">{t("adminDash.attention.intro")}</p>
              {data.allClear && <p className="ov__allclear" role="status">{t("adminDash.attention.allClear")}</p>}
              <ul className="ov__rows">
                {data.attention.map((row) => (
                  <li key={row.key}>
                    <Link to={ATTENTION_LINKS[row.key]} className={`ov__row${row.count === 0 ? " is-muted" : ""}`}>
                      <span className="ov__count" aria-label={String(row.count)}>{row.count}</span>
                      <span className="ov__row-text">
                        <strong>{t(`adminDash.attention.rows.${row.key}.title`)}</strong>
                        <span>{attentionText(row)}</span>
                      </span>
                      <span className="ov__open">
                        {t("adminDash.attention.open")}
                        <ChevronRight size={16} aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
              <section className="ov__card" aria-labelledby="ov-shortcuts-title">
              <h2 id="ov-shortcuts-title" className="ov__h2">{t("adminDash.shortcuts.title")}</h2>
              <p className="ov__sub">{t("adminDash.shortcuts.intro")}</p>
              <ul className="ov__shortcuts">
                <li><Link className="ov__btn" to="/admin/verification">{t("adminDash.shortcuts.employerVerification")}</Link></li>
                <li><Link className="ov__btn" to="/admin/job-monitoring">{t("adminDash.shortcuts.jobMonitoring")}</Link></li>
                {isSuperadmin ? (
                  <>
                    <li><Link className="ov__btn" to="/admin/users">{t("adminDash.shortcuts.userManagement")}</Link></li>
                    <li><Link className="ov__btn" to="/superadmin/admin-accounts">{t("adminDash.shortcuts.provisionStaff")}</Link></li>
                  </>
                ) : (
                  // User Management is a superadmin page; a PESO admin finds people here instead.
                  <li><Link className="ov__btn" to="/admin/find-account"><UserRound size={16} aria-hidden="true" />{t("adminDash.shortcuts.findAccount")}</Link></li>
                )}
              </ul>
          </section>
            </div>
            <div className="ov__col">
              <section className="ov__card" aria-labelledby="ov-muni-title">
              <h2 id="ov-muni-title" className="ov__h2">{t("adminDash.municipality.title")}</h2>
              <p className="ov__sub">{t("adminDash.municipality.intro")}</p>
              <table className="ov__bars">
                <caption className="ds-sr-only">{t("adminDash.municipality.title")}</caption>
                <tbody>
                  {data.jobseekersByMunicipality.map((row) => (
                    <tr key={row.municipality}>
                      <th scope="row">{row.municipality}</th>
                      <td>
                        <span className="ov__track" aria-hidden="true">
                          <span className="ov__fill" style={{ width: `${Math.round(((row.value || 0) / maxMunicipality) * 100)}%` }} />
                        </span>
                        <strong>{row.value}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link className="ov__btn" to="/admin/reports">{t("adminDash.municipality.open")}</Link>
            </section>
              <section className="ov__card" aria-labelledby="ov-recent-title">
              <h2 id="ov-recent-title" className="ov__h2">{t("adminDash.recent.title")}</h2>
              {data.recentActivity.length === 0 ? (
                <p className="ov__sub">{t("adminDash.recent.empty")}</p>
              ) : (
                <ul className="ov__activity">
                  {data.recentActivity.map((item) => (
                    <li key={item.id}>
                      <span>{actionText(item.action)}</span>
                      <small>
                        {t(`adminDash.recent.severity.${item.severity}`, { defaultValue: item.severity })} · {dateText(item.at, i18n.language)}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              {isSuperadmin && <Link className="ov__btn" to="/admin/audit-logs">{t("adminDash.recent.viewAll")}</Link>}
            </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
