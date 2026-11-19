import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, TriangleAlert, UserRound } from "lucide-react";
import { adminAPI } from "../../services/api";
import MetricCard from "../../components/MetricCard";
import StateBlock from "../../components/StateBlock";
import DeleteUserModal from "../../components/DeleteUserModal";
import "../../styles/admin.css";
import "../../styles/user-management.css";
import AdminHeader from "./AdminHeader";
import AccountSecuritySummary from "../../components/AccountSecuritySummary";
import { userContactLabel } from "../../utils/usernameSignup";
import { getAccountState, getAvailableActions } from "../../utils/userStatus";
import {
  STATUS_OPTIONS,
  VERIFICATION_OPTIONS,
  SORT_OPTIONS,
  hasActiveFilters,
  parseDirectoryState,
  serializeDirectoryState,
  toApiParams,
} from "../../utils/userDirectoryParams";
import { createDebouncer } from "../../utils/liveSearch";
import { downloadBlob } from "../../utils/exportUtils";

const tabMeta = {
  employers: {
    labelKey: "superadmin.users.tabs.employers",
    Icon: Building2,
    badgeKey: "employerCount",
  },
  jobseekers: {
    labelKey: "superadmin.users.tabs.jobseekers",
    Icon: UserRound,
    badgeKey: "jobseekerCount",
  },
};

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function UserStatCards({ employers, jobseekers }) {
  const { t } = useTranslation();
  const stats = [
    { key: "employers", label: t("admin.kpi.employers"), value: employers, icon: <Building2 size={20} /> },
    { key: "jobseekers", label: t("admin.kpi.jobSeekers"), value: jobseekers, icon: <UserRound size={20} /> },
  ];

  return (
    <section className="admin-user-summary ds-metrics um-summary" aria-label={t("superadmin.users.summaryLabel")}>
      {stats.map((stat) => (
        <MetricCard key={stat.key} icon={stat.icon} value={stat.value} label={stat.label} />
      ))}
    </section>
  );
}

function UserDirectoryEmpty({ role, filtered }) {
  const { t } = useTranslation();
  if (filtered) {
    return (
      <StateBlock
        kind="empty"
        className="um-state"
        title={t("superadmin.users.filters.noMatchTitle")}
        description={t("superadmin.users.filters.noMatchDescription")}
      />
    );
  }
  return (
    <StateBlock
      kind="empty"
      className="um-state"
      title={t(`superadmin.users.empty.${role}Title`)}
      description={t("superadmin.users.empty.description")}
    />
  );
}

// Text label plus a shape cue (see user-management.css): never colour alone.
function StatusBadge({ user }) {
  const { t } = useTranslation();
  const state = getAccountState(user);
  return (
    <>
      <span className={`um-badge um-badge--${state}`}>{t(`superadmin.users.status.${state}`)}</span>
      {state === "deleted" && user.purgeAfter ? (
        <span className="um-until">{t("superadmin.users.deletedUntil", { date: formatDate(user.purgeAfter) })}</span>
      ) : null}
    </>
  );
}

function RowActions({ user, onViewProfile, onToggleStatus, onDelete, onRestore }) {
  const { t } = useTranslation();
  const actions = getAvailableActions(user);
  return (
    <div className="um-actions">
      <button className="um-btn" type="button" onClick={() => onViewProfile(user)}>
        {t("superadmin.users.actions.view")}
      </button>
      {actions.deactivate && (
        <button className="um-btn" type="button" onClick={() => onToggleStatus(user)}>
          {t("superadmin.users.actions.deactivate")}
        </button>
      )}
      {actions.reactivate && (
        <button className="um-btn" type="button" onClick={() => onToggleStatus(user)}>
          {t("superadmin.users.actions.reactivate")}
        </button>
      )}
      {actions.delete && (
        <button className="um-btn um-btn--danger-outline" type="button" onClick={() => onDelete(user)}>
          {t("superadmin.users.actions.delete")}
        </button>
      )}
      {actions.restore && (
        <button className="um-btn" type="button" onClick={() => onRestore(user)}>
          {t("superadmin.users.actions.restore")}
        </button>
      )}
    </div>
  );
}

function UserDirectoryCards({ title, role, data, handlers, filtered }) {
  const { t } = useTranslation();
  return (
    <div className="admin-mobile-user-list" aria-label={`${title} mobile directory`}>
      {data.length === 0 ? (
        <UserDirectoryEmpty role={role} filtered={filtered} />
      ) : (
        data.map((user) => (
          <article key={user._id} className="admin-mobile-user-card">
            <div className="admin-mobile-user-card__header">
              <h4>{user.name}</h4>
              <div><StatusBadge user={user} /></div>
            </div>

            <div className="admin-mobile-user-card__meta">
              <div>
                <label>{t("superadmin.users.columns.contact")}</label>
                <p>{userContactLabel(user)}</p>
              </div>
              <div>
                <label>{t("superadmin.users.columns.joined")}</label>
                <p>{formatDate(user.createdAt)}</p>
              </div>
            </div>

            <div className="admin-mobile-user-card__actions">
              <RowActions user={user} {...handlers} />
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function UserDirectory({ title, role, data, handlers, filtered }) {
  const { t } = useTranslation();
  return (
    <div className="admin-panel-card">
      <div className="admin-card-header">
        <h3>{title}</h3>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("superadmin.users.columns.name")}</th>
              <th>{t("superadmin.users.columns.contact")}</th>
              <th>{t("superadmin.users.columns.status")}</th>
              <th>{t("superadmin.users.columns.joined")}</th>
              <th>{t("superadmin.users.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="um-empty-cell"><UserDirectoryEmpty role={role} filtered={filtered} /></td>
              </tr>
            ) : (
              data.map((user) => (
                <tr key={user._id}>
                  <td>{user.name}</td>
                  <td>{userContactLabel(user)}</td>
                  <td><StatusBadge user={user} /></td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td><RowActions user={user} {...handlers} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <UserDirectoryCards title={title} role={role} data={data} handlers={handlers} filtered={filtered} />
    </div>
  );
}

// Builds a page-number list with "…" gap markers, e.g. [1, "…", 4, 5, 6, "…", 12].
function buildPageList(current, total) {
  const pages = [];
  for (let i = 1; i <= total; i += 1) {
    if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
      pages.push(i);
    }
  }

  const withEllipsis = [];
  let previous = 0;
  for (const i of pages) {
    if (previous && i - previous > 1) {
      withEllipsis.push("…");
    }
    withEllipsis.push(i);
    previous = i;
  }
  return withEllipsis;
}

export default function UserManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Filters, sort, tab and page live in the URL (replace, never push) so a
  // reload or a shared link shows the same list.
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseDirectoryState(searchParams), [searchParams]);
  const { tab: activeTab, page } = state;
  const [searchText, setSearchText] = useState(state.q);
  const searchDebouncer = useRef(createDebouncer(300));
  const [exporting, setExporting] = useState(false);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMatching, setTotalMatching] = useState(0);
  // Independent of the current page/tab — the tab badges need the TRUE total
  // per role, not just how many rows happen to be on the current page.
  const [counts, setCounts] = useState({ employerCount: 0, jobseekerCount: 0 });
  const [selectedUser, setSelectedUser] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionToast, setActionToast] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendPermanent, setSuspendPermanent] = useState(false);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!actionToast) return;

    const timer = window.setTimeout(() => {
      setActionToast(null);
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [actionToast]);

  // Any change to a filter, the sort or the tab goes back to page 1; only the
  // pager keeps the page.
  // Functional update: a debounced search never overwrites a filter that was
  // changed while it was waiting.
  const updateState = useCallback(
    (patch) => {
      setSearchParams(
        (previous) => {
          const next = { ...parseDirectoryState(previous), ...patch };
          if (!("page" in patch)) next.page = 1;
          return serializeDirectoryState(next);
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const stateKey = serializeDirectoryState(state).toString();

  useEffect(() => {
    const debouncer = searchDebouncer.current;
    return () => debouncer.cancel();
  }, []);

  const onSearchChange = (value) => {
    setSearchText(value);
    searchDebouncer.current.schedule(() => updateState({ q: value }));
  };

  const clearFilters = () => {
    searchDebouncer.current.cancel();
    setSearchText("");
    updateState({ q: "", status: "", verification: "", noEmail: false, idle90: false, lockedNow: false });
  };

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      setLoading(true);
      try {
        const { data } = await adminAPI.getUsers(toApiParams(parseDirectoryState(new URLSearchParams(stateKey))));
        if (!isMounted) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
        setTotalPages(Math.max(Number(data?.totalPages) || 1, 1));
        setTotalMatching(Number(data?.total) || 0);
      } catch {
        if (isMounted) {
          setUsers([]);
          setTotalPages(1);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadUsers();
    return () => {
      isMounted = false;
    };
  }, [stateKey, reloadKey]);

  // Total counts for the tab badges. Deleted accounts are not counted, and the
  // numbers refresh after every delete or restore.
  useEffect(() => {
    let isMounted = true;

    const loadCounts = async () => {
      try {
        const [employerRes, jobseekerRes] = await Promise.all([
          adminAPI.getUsers({ role: "employer", page: 1, limit: 1 }),
          adminAPI.getUsers({ role: "jobseeker", page: 1, limit: 1 }),
        ]);
        if (!isMounted) return;
        setCounts({
          employerCount: Number(employerRes.data?.total) || 0,
          jobseekerCount: Number(jobseekerRes.data?.total) || 0,
        });
      } catch {
        // Badge counts are a nice-to-have; leave them at 0 on failure rather
        // than blocking the directory table itself.
      }
    };

    loadCounts();
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  const directoryTitle = activeTab === "jobseekers" ? "Jobseekers Directory" : "Employers Directory";

  const performToggleUserStatus = async (user) => {
    const nextStatus = user.isActive === false;
    const action = nextStatus ? "reactivate" : "deactivate";

    try {
      if (nextStatus) {
        await adminAPI.reactivateUser(user._id);
      } else {
        await adminAPI.deactivateUser(user._id, {
          reason: suspendReason.trim(),
          permanent: suspendPermanent,
        });
      }

      // Reload so the row shows the real state (suspended or banned) and the
      // right buttons (Delete appears once an account is inactive).
      reload();

      setActionToast({
        type: "success",
        message: `${user.name} has been ${
          nextStatus ? "reactivated" : suspendPermanent ? "banned" : "suspended"
        }.`,
      });
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || `Failed to ${action} ${user.name || "user"}.`,
      });
    } finally {
      setSelectedUser(null);
      setSuspendReason("");
      setSuspendPermanent(false);
    }
  };

  const handleToggleUserStatus = (user) => {
    setSuspendReason("");
    setSuspendPermanent(false);
    setSelectedUser(user);
  };

  const handleViewProfile = (user) => {
    navigate(`/admin/users/${user._id}`);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data } = await adminAPI.exportUsersCsv(toApiParams(state, { withPaging: false }));
      downloadBlob(`users-${new Date().toISOString().slice(0, 10)}.csv`, data);
      setActionToast({ type: "success", message: t("superadmin.users.export.success") });
    } catch {
      setActionToast({ type: "error", message: t("superadmin.users.export.error") });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleted = (user, data) => {
    setDeleteTarget(null);
    reload();
    setActionToast({
      type: "success",
      message: t("superadmin.users.delete.success", { name: user.name, days: data?.graceDays ?? 30 }),
    });
  };

  const handleRestore = async (user) => {
    try {
      await adminAPI.restoreUser(user._id);
      reload();
      setActionToast({ type: "success", message: t("superadmin.users.restore.success", { name: user.name }) });
    } catch (error) {
      setActionToast({
        type: "error",
        message: error.response?.data?.message || t("superadmin.users.restore.error"),
      });
    }
  };

  const handlers = {
    onViewProfile: handleViewProfile,
    onToggleStatus: handleToggleUserStatus,
    onDelete: setDeleteTarget,
    onRestore: handleRestore,
  };

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="admin-panel-card">
          <StateBlock kind="loading" className="um-state" title={t("superadmin.users.loading")} />
        </div>
      );
    }

    return (
      <UserDirectory
        title={directoryTitle}
        role={activeTab === "jobseekers" ? "jobseekers" : "employers"}
        data={users}
        handlers={handlers}
        filtered={hasActiveFilters(state)}
      />
    );
  };

  return (
    <div className="admin-page-container um-page">
      <AdminHeader
        title={t("navbar.userManagement")}
        description={t("superadmin.users.subtitle")}
      />

      <UserStatCards
        employers={counts.employerCount}
        jobseekers={counts.jobseekerCount}
      />

      <div className="ds-tabs um-tabs" role="tablist" aria-label={t("superadmin.users.tabsLabel")}>
        {Object.entries(tabMeta).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`ds-tab um-tab ${activeTab === key ? "is-active" : ""}`}
            onClick={() => {
              searchDebouncer.current.cancel();
              updateState({ tab: key });
            }}
          >
            <meta.Icon size={18} aria-hidden="true" />
            <span>{t(meta.labelKey)}</span>
            <span className="ds-tab__count">
              {counts[meta.badgeKey]}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "jobseekers" && <AccountSecuritySummary />}

      <form
        className="um-filters"
        role="search"
        aria-label={t("superadmin.users.filters.label")}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="um-field um-field--grow">
          <label htmlFor="um-search">{t("superadmin.users.filters.search")}</label>
          <input
            id="um-search"
            type="search"
            value={searchText}
            maxLength={100}
            placeholder={t("superadmin.users.filters.searchPlaceholder")}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="um-field">
          <label htmlFor="um-status">{t("superadmin.users.filters.status")}</label>
          <select id="um-status" value={state.status} onChange={(event) => updateState({ status: event.target.value })}>
            <option value="">{t("superadmin.users.filters.statusAll")}</option>
            {STATUS_OPTIONS.map((key) => (
              <option key={key} value={key}>{t(`superadmin.users.status.${key}`)}</option>
            ))}
          </select>
        </div>

        {activeTab === "employers" && (
          <div className="um-field">
            <label htmlFor="um-verification">{t("superadmin.users.filters.verification")}</label>
            <select
              id="um-verification"
              value={state.verification}
              onChange={(event) => updateState({ verification: event.target.value })}
            >
              <option value="">{t("superadmin.users.filters.verificationAll")}</option>
              {VERIFICATION_OPTIONS.map((key) => (
                <option key={key} value={key}>{t(`superadmin.users.filters.verificationOptions.${key}`)}</option>
              ))}
            </select>
          </div>
        )}

        <div className="um-field">
          <label htmlFor="um-sort">{t("superadmin.users.filters.sort")}</label>
          <select id="um-sort" value={state.sort} onChange={(event) => updateState({ sort: event.target.value, order: "" })}>
            {SORT_OPTIONS.map((key) => (
              <option key={key} value={key}>{t(`superadmin.users.filters.sortOptions.${key}`)}</option>
            ))}
          </select>
        </div>

        <div className="um-field">
          <label htmlFor="um-order">{t("superadmin.users.filters.order")}</label>
          <select id="um-order" value={state.order} onChange={(event) => updateState({ order: event.target.value })}>
            <option value="">{t("superadmin.users.filters.orderNewest")}</option>
            <option value="asc">{t("superadmin.users.filters.orderAsc")}</option>
            <option value="desc">{t("superadmin.users.filters.orderDesc")}</option>
          </select>
        </div>

        <div className="um-checks">
          <label className="um-check">
            <input type="checkbox" checked={state.noEmail} onChange={(event) => updateState({ noEmail: event.target.checked })} />
            <span>{t("superadmin.users.filters.noEmail")}</span>
          </label>
          <label className="um-check">
            <input type="checkbox" checked={state.idle90} onChange={(event) => updateState({ idle90: event.target.checked })} />
            <span>{t("superadmin.users.filters.idle90")}</span>
          </label>
          <label className="um-check">
            <input type="checkbox" checked={state.lockedNow} onChange={(event) => updateState({ lockedNow: event.target.checked })} />
            <span>{t("superadmin.users.filters.lockedNow")}</span>
          </label>
        </div>

        <div className="um-filters__actions">
          {hasActiveFilters(state) && (
            <button type="button" className="um-btn" onClick={clearFilters}>{t("superadmin.users.filters.clear")}</button>
          )}
          <button type="button" className="um-btn" onClick={handleExport} disabled={exporting} aria-describedby="um-export-hint">
            {exporting ? t("superadmin.users.export.exporting") : t("superadmin.users.export.button")}
          </button>
        </div>
        <small id="um-export-hint" className="um-filters__hint">{t("superadmin.users.export.hint")}</small>
      </form>

      <p className="um-count" role="status" aria-live="polite">
        {loading ? "" : t("superadmin.users.filters.results", { count: totalMatching })}
      </p>

      <div className="tab-content">{renderTabContent()}</div>

      {(
        <nav className="admin-pagination um-pagination" aria-label={t("superadmin.pagination.label")}>
          <button
            type="button"
            disabled={page === 1}
            onClick={() => updateState({ page: Math.max(1, page - 1) })}
          >
            Previous
          </button>
          <div className="um-pagination__pages">
            {buildPageList(page, totalPages).map((item, index) =>
              item === "…" ? (
                <span key={`ellipsis-${index}`} className="um-pagination__ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`um-pagination__page ${item === page ? "active" : ""}`}
                  aria-current={item === page ? "page" : undefined}
                  disabled={item === page}
                  onClick={() => updateState({ page: item })}
                >
                  {item}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => updateState({ page: Math.min(totalPages, page + 1) })}
          >
            Next
          </button>
        </nav>
      )}

      {selectedUser ? (
        <div className="admin-warning-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div
            className="admin-warning-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-warning-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-warning-modal-header">
              <div className="admin-warning-modal-icon" aria-hidden="true"><TriangleAlert size={22} /></div>
              <div>
                <h3 id="um-warning-title">{selectedUser.isActive === false ? "Reactivate user" : "Deactivate user"}</h3>
              </div>
            </div>

            <p className="admin-warning-modal-text">
              You are about to {selectedUser.isActive === false ? "reactivate" : suspendPermanent ? "ban" : "suspend"} <strong>{selectedUser.name}</strong>.
              {selectedUser.isActive === false
                ? " This will restore account access for this user."
                : suspendPermanent
                  ? " This permanently revokes their access. They can still appeal to LMD Admin."
                  : " This disables their access until reactivated. They can appeal to LMD Admin."}
            </p>

            {selectedUser.isActive !== false ? (
              <div className="admin-suspend-fields">
                <label>
                  Reason (shown to the user)
                  <input
                    type="text"
                    value={suspendReason}
                    onChange={(event) => setSuspendReason(event.target.value)}
                    placeholder="e.g. Posting a fraudulent job vacancy"
                  />
                </label>
                <label className="admin-suspend-permanent">
                  <input
                    type="checkbox"
                    checked={suspendPermanent}
                    onChange={(event) => setSuspendPermanent(event.target.checked)}
                  />
                  <span>Permanent ban (instead of a temporary suspension)</span>
                </label>
              </div>
            ) : null}

            <div className="admin-warning-modal-actions">
              <button type="button" className="admin-warning-cancel" onClick={() => setSelectedUser(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-warning-confirm"
                onClick={async () => {
                  const user = selectedUser;
                  setSelectedUser(null);
                  await performToggleUserStatus(user);
                }}
              >
                {selectedUser.isActive === false ? "Reactivate" : suspendPermanent ? "Ban user" : "Suspend user"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <DeleteUserModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      ) : null}

      {actionToast && (
        <div className={`admin-toast admin-toast--${actionToast.type}`} role="status" aria-live="polite">
          {actionToast.message}
        </div>
      )}
    </div>
  );
}
