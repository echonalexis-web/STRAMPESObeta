import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, TriangleAlert, UserRound } from "lucide-react";
import { adminAPI } from "../../services/api";
import DeleteUserModal from "../../components/DeleteUserModal";
import Pagination from "../../components/Pagination";
import UserDirectoryList from "../../components/UserDirectoryList";
import UserDirectoryToolbar from "../../components/UserDirectoryToolbar";
import useMediaQuery from "../../hooks/useMediaQuery";
import "../../styles/admin.css";
import "../../styles/user-management.css";
import {
  CLEAR_PATCH,
  MOBILE_PAGE_SIZE,
  PAGE_SIZE,
  hasActiveFilters,
  isCanonicalQuery,
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
  },
  jobseekers: {
    labelKey: "superadmin.users.tabs.jobseekers",
    Icon: UserRound,
  },
};

// A phone gets cards, a smaller page and the collapsible Filters panel.
const MOBILE_QUERY = "(max-width: 600px)";

export default function UserManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Filters, sort, tab and page live in the URL (replace, never push) so a
  // reload or a shared link shows the same list.
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseDirectoryState(searchParams), [searchParams]);
  const { tab: activeTab, page } = state;
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const pageSize = isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE;
  const [searchText, setSearchText] = useState(state.q);
  const searchDebouncer = useRef(createDebouncer(300));
  const [exporting, setExporting] = useState(false);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalMatching, setTotalMatching] = useState(0);
  // Server counts for the tab labels and the filter chips. They ignore the
  // search box and the other filters, so the numbers stay stable.
  const [counts, setCounts] = useState(null);
  const [lockouts, setLockouts] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
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

  // A link that carries a filter this tab does not show (for example No email on
  // Employers) is rewritten once without it, so an invisible filter can never
  // be hiding rows.
  useEffect(() => {
    if (!isCanonicalQuery(searchParams)) {
      setSearchParams(serializeDirectoryState(parseDirectoryState(searchParams)), { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
    updateState(CLEAR_PATCH);
  };

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      setLoading(true);
      setOpenMenuId(null);
      try {
        const { data } = await adminAPI.getUsers(
          toApiParams(parseDirectoryState(new URLSearchParams(stateKey)), { pageSize, details: true })
        );
        if (!isMounted) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
        setTotalMatching(Number(data?.total) || 0);
      } catch {
        if (isMounted) {
          setUsers([]);
          setTotalMatching(0);
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
  }, [stateKey, reloadKey, pageSize]);

  // A shorter page size (a phone) or a removed row can leave the URL on a page
  // that no longer exists: go to the last one that does.
  useEffect(() => {
    if (loading || users.length > 0 || totalMatching === 0 || page <= 1) return;
    updateState({ page: Math.max(1, Math.ceil(totalMatching / pageSize)) });
  }, [loading, users.length, totalMatching, page, pageSize, updateState]);

  // Tab totals and chip counts: deleted accounts are not counted, and the
  // numbers refresh after every delete or restore.
  useEffect(() => {
    let isMounted = true;
    adminAPI
      .getUserDirectoryCounts()
      .then(({ data }) => {
        if (isMounted) setCounts(data || null);
      })
      .catch(() => {
        // Counts are a nice-to-have; the directory itself still works.
      });
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  // The 24 hour / 7 day lockout line beside the Jobseekers chips.
  useEffect(() => {
    let isMounted = true;
    adminAPI
      .getAccountSecuritySummary()
      .then(({ data }) => {
        if (isMounted && data) setLockouts({ locksLast24h: Number(data.locksLast24h) || 0, locksLast7d: Number(data.locksLast7d) || 0 });
      })
      .catch(() => {
        // The line is simply left out.
      });
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

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
    } catch (error) {
      setActionToast({
        type: "error",
        message: t(error.response?.status === 422 ? "superadmin.users.export.tooLarge" : "superadmin.users.export.error"),
      });
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

  const filtered = hasActiveFilters(state);
  const tabCounts = counts ? counts[activeTab] : null;

  return (
    <div className="admin-page-container um-page">
      {/* The top bar shows the page title; this keeps the page's own heading for screen readers. */}
      <h1 className="ds-sr-only">{t("navbar.userManagement")}</h1>

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
            <span className="ds-tab__count">{counts?.[key]?.total ?? 0}</span>
          </button>
        ))}
      </div>

      <section className="um-card" aria-label={t(tabMeta[activeTab].labelKey)}>
        <UserDirectoryToolbar
          state={state}
          searchText={searchText}
          onSearchChange={onSearchChange}
          updateState={updateState}
          counts={tabCounts}
          lockouts={activeTab === "jobseekers" ? lockouts : null}
          isMobile={isMobile}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          onExport={handleExport}
          exporting={exporting}
        />

        <div className="um-list">
          <UserDirectoryList
            users={users}
            role={activeTab}
            isMobile={isMobile}
            loading={loading}
            filtered={filtered}
            onClear={clearFilters}
            handlers={handlers}
            openMenuId={openMenuId}
            onOpenMenuChange={setOpenMenuId}
          />
        </div>

        <p className="ds-sr-only" role="status" aria-live="polite">
          {loading ? "" : t("superadmin.users.filters.results", { count: totalMatching })}
        </p>

        <div className="um-footer">
          <Pagination
            total={totalMatching}
            page={page}
            pageSize={pageSize}
            showPageSize={false}
            idPrefix="um-pager"
            label={t("pagination.items.accounts")}
            onPageChange={(next) => updateState({ page: next })}
            summaryExtra={
              filtered ? (
                <button type="button" className="um-linkbtn" onClick={clearFilters}>
                  {t("superadmin.users.filters.clear")}
                </button>
              ) : null
            }
          />
          <p className="um-hint" id="um-export-hint">{t("superadmin.users.export.hint")}</p>
        </div>
      </section>

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
