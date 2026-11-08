import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { resolveAssetUrl, spesAPI } from "../../services/api";
import StateBlock from "../../components/StateBlock";
import SpesReleaseDialog from "../../components/SpesReleaseDialog";
import { useConfirm, useToast } from "../../components/feedback/context";
import { translateErrorCode } from "../../utils/apiErrors";
import { formatSpesDate } from "../../utils/spesPostings";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/spes.css";

const FILTERS = ["all", "draft", "open", "closed", "results_released", "archived"];
const COUNT_STATUSES = ["submitted", "documents_review", "needs_resubmission", "qualified", "evaluated", "result_recorded", "results_released"];

// Staff list of SPES postings: status, application period and counts, with the
// actions that belong to each state (edit, publish, close or reopen, release results,
// archive, delete a draft). Applications themselves are handled under SPES Monitoring.
export default function SpesPostingsAdmin() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [releaseFor, setReleaseFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await spesAPI.adminPostings({ status: filter === "all" ? undefined : filter });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, successKey) => {
    try {
      await fn();
      toast.success(t(successKey));
      load();
    } catch (err) {
      toast.error(translateErrorCode(err?.response?.data?.code, err?.response?.data?.message || t("spes.admin.saveFailed")));
    }
  };

  const ask = (titleKey, bodyKey, confirmKey, tone) =>
    confirm({ title: t(titleKey), message: t(bodyKey), confirmLabel: t(confirmKey), tone });

  const toggleClosed = async (p) => {
    const closing = p.displayStatus === "open";
    const ok = await ask(
      closing ? "spesPostings.admin.closeTitle" : "spesPostings.admin.reopenTitle",
      closing ? "spesPostings.admin.closeBody" : "spesPostings.admin.reopenBody",
      closing ? "spes.admin.closeApplications" : "spes.admin.reopenApplications"
    );
    if (ok) act(() => spesAPI.adminSetPostingClosed(p._id, closing), closing ? "spes.admin.closedToast" : "spes.admin.reopenedToast");
  };

  const publish = async (p) => {
    const ok = await ask("spesPostings.admin.publishTitle", "spesPostings.admin.publishBody", "spesPostings.admin.publish");
    if (ok) act(() => spesAPI.adminSetPostingStatus(p._id, "published", true), "spesPostings.admin.published");
  };

  const archive = async (p) => {
    const ok = await ask("spesPostings.admin.archiveTitle", "spesPostings.admin.archiveBody", "spesPostings.admin.archive", "danger");
    if (ok) act(() => spesAPI.adminSetPostingStatus(p._id, "archived"), "spesPostings.admin.archived");
  };

  const remove = async (p) => {
    const ok = await ask("spesPostings.admin.deleteTitle", "spesPostings.admin.deleteBody", "spesPostings.admin.delete", "danger");
    if (ok) act(() => spesAPI.adminDeletePosting(p._id), "spesPostings.admin.deleted");
  };

  return (
    <div className="admin-page-container spes-admin">
      <AdminHeader title={t("spesPostings.adminTitle")} description={t("spesPostings.adminDescription")} />

      <div className="spes-admin-bar">
        <label className="spes-admin-bar__filter">
          {t("spes.admin.filterStatus")}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? t("spesPostings.admin.filterAll") : t(`spesPostings.status.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <Link to="/admin/spes/postings/new" className="spes-btn">
          {t("spesPostings.admin.newPosting")}
        </Link>
      </div>

      {loading ? <StateBlock kind="loading" title={t("admin.spes.loading")} /> : null}
      {!loading && error ? (
        <StateBlock
          kind="error"
          title={t("spesPostings.admin.loadFailed")}
          action={<button type="button" className="spes-btn spes-btn--small" onClick={load}>{t("spes.admin.retry")}</button>}
        />
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <StateBlock
          kind="empty"
          title={t("spesPostings.adminEmptyTitle")}
          description={t("spesPostings.adminEmptyBody")}
          action={<Link to="/admin/spes/postings/new" className="spes-btn spes-btn--small">{t("spesPostings.admin.newPosting")}</Link>}
        />
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="spes-programs__grid">
          {items.map((p) => {
            const status = p.displayStatus;
            const counts = p.counts?.byStatus || {};
            const total = p.counts?.total || 0;
            const canEdit = !p.legacy && status !== "archived";
            return (
              <article key={p._id} className="spes-program-card">
                {p.coverImage ? <img className="spes-posting-card__cover" src={resolveAssetUrl(p.coverImage)} alt="" loading="lazy" /> : null}
                <div className="spes-program-card__head">
                  <h2>{p.title}</h2>
                  <span className={`spes-chip spes-chip--posting-${status}`}>{t(`spesPostings.status.${status}`)}</span>
                </div>
                <p className="spes-card__meta">
                  {p.applicationDeadline
                    ? t("spes.panel.deadline", { date: formatSpesDate(p.applicationDeadline, i18n.language) })
                    : t("spes.admin.noDeadline")}
                  {" · "}
                  {t("spes.admin.applicantCount", { count: total })}
                </p>
                {status === "closed" && p.closedReason ? (
                  <p className="spes-program-card__reason">{t(`spes.admin.closedReason.${p.closedReason}`)}</p>
                ) : null}
                {p.legacy ? <p className="spes-note">{t("spesPostings.admin.legacyNote")}</p> : null}
                <div className="spes-program-card__counts">
                  {COUNT_STATUSES.filter((s) => counts[s]).map((s) => (
                    <span key={s} className={`spes-chip spes-chip--${s}`}>{t(`spes.status.${s}`)} · {counts[s]}</span>
                  ))}
                </div>
                <div className="spes-program-card__actions">
                  {canEdit ? (
                    <Link to={`/admin/spes/postings/${p._id}/edit`} className="spes-btn spes-btn--small spes-btn--ghost">
                      {t("spesPostings.admin.edit")}
                    </Link>
                  ) : null}
                  <Link to={`/admin/spes/monitoring?posting=${p._id}`} className="spes-btn spes-btn--small spes-btn--ghost">
                    {t("spesPostings.admin.monitor")}
                  </Link>
                  {status === "draft" && !p.legacy ? (
                    <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => publish(p)}>
                      {t("spesPostings.admin.publish")}
                    </button>
                  ) : null}
                  {status === "open" || (status === "closed" && p.closedReason === "manual") ? (
                    <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => toggleClosed(p)}>
                      {status === "open" ? t("spes.admin.closeApplications") : t("spes.admin.reopenApplications")}
                    </button>
                  ) : null}
                  {status === "draft" && !p.legacy && total === 0 ? (
                    <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => remove(p)}>
                      {t("spesPostings.admin.delete")}
                    </button>
                  ) : null}
                  {(status === "open" || status === "closed") && !p.legacy ? (
                    <button type="button" className="spes-btn spes-btn--small spes-btn--ghost" onClick={() => archive(p)}>
                      {t("spesPostings.admin.archive")}
                    </button>
                  ) : null}
                  {(status === "open" || status === "closed") ? (
                    <button
                      type="button"
                      className="spes-btn spes-btn--small spes-program-card__release"
                      onClick={() => setReleaseFor(p)}
                      disabled={!total}
                    >
                      {t("spes.admin.release")}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {releaseFor ? (
        <SpesReleaseDialog posting={releaseFor} onClose={() => setReleaseFor(null)} onReleased={load} />
      ) : null}
    </div>
  );
}
