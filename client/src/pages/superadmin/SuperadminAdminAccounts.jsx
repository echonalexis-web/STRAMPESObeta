import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FaUserShield,
  FaUserPlus,
  FaKey,
  FaBan,
  FaCircleCheck,
  FaCopy,
  FaCheck,
  FaMagnifyingGlass,
  FaXmark,
  FaTriangleExclamation,
  FaPaperPlane,
  FaTrashCan,
} from "react-icons/fa6";
import Pagination from "../../components/Pagination";
import usePagination from "../../hooks/usePagination";
import StateBlock from "../../components/StateBlock";
import AccountStatusBadge from "../../components/AccountStatusBadge";
import ProvisionStaffModal from "../../components/ProvisionStaffModal";
import { POSITION_PRESETS } from "../../constants/staffPositions";
import { useToast } from "../../components/feedback/context";
import { BackToConsole, ConsoleHero } from "./ConsoleShell";
import { superadminAPI } from "../../services/api";
import "../../styles/staff-invite.css";

const NOTE_PRESETS = POSITION_PRESETS;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "disabled", label: "Disabled" },
];

const formatDate = (value) => {
  if (!value) return "Never signed in";
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

// pending / expired: a provisioned account waiting for its owner to activate it
// (an invite). pendingPassword: an older account that must still replace a
// temporary password after a reset. The "Pending" tab holds all three.
const statusOf = (admin) => {
  if (admin.accountStatus === "pending_activation") {
    return admin.invite && admin.invite.status === "expired" ? "expired" : "pending";
  }
  if (!admin.isActive) return "disabled";
  if (admin.mustChangePassword) return "pendingPassword";
  return "active";
};

const PENDING_GROUP = ["pending", "expired", "pendingPassword"];
const isInviteStatus = (status) => status === "pending" || status === "expired";
const BADGE_STATE = { pending: "pending", expired: "expired", active: "active", disabled: "deactivated" };

const formatWhen = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

// The Managed Admin Accounts function (its own page under the console launcher).
export default function SuperadminAdminAccounts() {
  const { t } = useTranslation();
  const toast = useToast();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Provisioning is an emailed invitation: no password is created or shown.
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [inviteSettings, setInviteSettings] = useState({ expiryHours: 48, cooldownSeconds: 60, maxResends: 10 });
  // Ticks once a second only while some resend button is cooling down.
  const [now, setNow] = useState(() => Date.now());

  // The last temporary password issued by "Reset password". Shown once, in a modal.
  const [issued, setIssued] = useState(null); // { email, tempPassword, context }
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Roster search + filter tab.
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // Pending confirmation dialog for a destructive action.
  const [confirmState, setConfirmState] = useState(null); // { title, message, confirmLabel, tone, onConfirm }

  const loadAdmins = useCallback(async () => {
    setError("");
    try {
      const { data } = await superadminAPI.listAdmins();
      setAdmins(Array.isArray(data?.admins) ? data.admins : []);
      if (data?.inviteSettings) setInviteSettings(data.inviteSettings);
      setNow(Date.now());
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load admin accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  // Escape closes the top-most overlay; body scroll locks while any is open.
  // (The provision dialog is an AppModal and handles its own Escape and focus.)
  useEffect(() => {
    const anyOverlay = Boolean(issued) || Boolean(confirmState);
    if (!anyOverlay) return undefined;

    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (confirmState) setConfirmState(null);
      else if (issued) setIssued(null);
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [issued, confirmState]);

  // The account is created pending activation and the email is queued by the
  // server; the toast says which of the two outcomes happened.
  const handleProvisioned = async (data) => {
    setProvisionOpen(false);
    const email = data?.admin?.email || "";
    if (data?.emailStatus === "failed") toast.error(t("staffInvite.toast.provisionedEmailFailed"));
    else toast.success(t("staffInvite.toast.provisioned", { email }));
    await loadAdmins();
  };

  const secondsUntil = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0);

  const hasCooldown = admins.some((a) => secondsUntil(a.invite && a.invite.nextResendAt) > 0);
  useEffect(() => {
    if (!hasCooldown) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasCooldown]);

  const doResend = async (admin) => {
    setBusyId(admin.id);
    try {
      const { data } = await superadminAPI.resendAdminInvite(admin.id);
      if (data?.emailStatus === "failed") toast.error(t("staffInvite.toast.resentFailed"));
      else toast.success(t("staffInvite.toast.resent", { email: admin.email }));
    } catch (err) {
      const body = err?.response?.data || {};
      if (body.code === "RESEND_COOLDOWN") toast.error(t("staffInvite.toast.cooldown", { seconds: body.retryAfterSeconds }));
      else if (body.code === "RESEND_LIMIT") toast.error(t("staffInvite.toast.limit"));
      else if (body.code === "NOT_PENDING") toast.error(t("staffInvite.toast.notPending"));
      else toast.error(t("staffInvite.toast.failed"));
    } finally {
      setBusyId(null);
      await loadAdmins();
    }
  };

  const doCancelInvite = async (admin) => {
    setBusyId(admin.id);
    try {
      await superadminAPI.cancelAdminInvite(admin.id);
      toast.success(t("staffInvite.toast.cancelled"));
    } catch (err) {
      toast.error(
        err?.response?.data?.code === "NOT_PENDING" ? t("staffInvite.toast.notPending") : t("staffInvite.toast.failed")
      );
    } finally {
      setBusyId(null);
      await loadAdmins();
    }
  };

  const requestCancelInvite = (admin) =>
    setConfirmState({
      title: t("staffInvite.cancelDialog.title"),
      message: t("staffInvite.cancelDialog.body", { email: admin.email }),
      confirmLabel: t("staffInvite.cancelDialog.confirm"),
      cancelLabel: t("staffInvite.cancelDialog.keep"),
      tone: "danger",
      onConfirm: () => doCancelInvite(admin),
    });

  const doToggleActive = async (admin, nextActive) => {
    setBusyId(admin.id);
    setError("");
    try {
      await superadminAPI.setAdminActive(admin.id, nextActive);
      await loadAdmins();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not update the account.");
    } finally {
      setBusyId(null);
    }
  };

  const doReset = async (admin) => {
    setBusyId(admin.id);
    setError("");
    try {
      const { data } = await superadminAPI.resetAdminPassword(admin.id);
      setIssued({ email: admin.email, tempPassword: data.tempPassword, context: "reset" });
      setCopied(false);
      await loadAdmins();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not reset the password.");
    } finally {
      setBusyId(null);
    }
  };

  const requestReset = (admin) =>
    setConfirmState({
      title: "Reset this admin's password?",
      message: `A new one-time password will be issued for ${admin.email}. Their current password stops working immediately, and they'll be forced to set a new one on their next sign-in.`,
      confirmLabel: "Reset password",
      tone: "warn",
      onConfirm: () => doReset(admin),
    });

  const requestDisable = (admin) =>
    setConfirmState({
      title: "Disable this admin account?",
      message: `${admin.email} will be signed out and blocked from signing in until you re-enable the account. Nothing is deleted.`,
      confirmLabel: "Disable account",
      tone: "danger",
      onConfirm: () => doToggleActive(admin, false),
    });

  const runConfirm = () => {
    const action = confirmState?.onConfirm;
    setConfirmState(null);
    if (action) action();
  };

  const copyCredentials = async () => {
    if (!issued?.tempPassword) return;
    const text = `Email: ${issued.email}\nTemporary password: ${issued.tempPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the value is visible for manual copy */
    }
  };

  const counts = useMemo(
    () => ({
      all: admins.length,
      active: admins.filter((a) => statusOf(a) === "active").length,
      pending: admins.filter((a) => PENDING_GROUP.includes(statusOf(a))).length,
      disabled: admins.filter((a) => statusOf(a) === "disabled").length,
    }),
    [admins]
  );

  const filteredAdmins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return admins.filter((admin) => {
      const rowStatus = statusOf(admin);
      if (filter === "pending" ? !PENDING_GROUP.includes(rowStatus) : filter !== "all" && rowStatus !== filter) return false;
      if (!q) return true;
      return (
        (admin.name || "").toLowerCase().includes(q) ||
        (admin.email || "").toLowerCase().includes(q) ||
        (admin.staffNote || "").toLowerCase().includes(q)
      );
    });
  }, [admins, search, filter]);

  const hasAnyAdmins = admins.length > 0;
  const tableRef = useRef(null);
  const pager = usePagination(filteredAdmins, { resetKey: `${filter}|${search}` });

  return (
    <div className="sac">
      <main className="sac__main scl-main">
        <BackToConsole />
        {/* Page-header band (.ds-pagehead) — holds the page's only <h1>. */}
        <ConsoleHero title={t("superadmin.launcher.functions.admin-accounts.title")} subtitle={t("superadmin.launcher.functions.admin-accounts.description")} />

        {error ? (
          <div className="sac__error ds-alert ds-alert--error" role="alert">
            <FaTriangleExclamation aria-hidden="true" /> <span className="ds-alert__body">{error}</span>
          </div>
        ) : null}

        <section className="sac__card sac__roster">
          <header className="sac__roster-head">
            <div className="sac__roster-heading">
              <h2><FaUserShield aria-hidden="true" /> {t("superadmin.console.rosterTitle")}</h2>
              <span className="sac__count">{t("superadmin.console.totalCount", { count: counts.all })}</span>
            </div>
            <button
              type="button"
              className="sac__primary sac__provision-trigger"
              onClick={() => setProvisionOpen(true)}
            >
              <FaUserPlus aria-hidden="true" /> {t("superadmin.console.provision")}
            </button>
          </header>

          <div className="sac__toolbar ds-toolbar">
            <div className="sac__search">
              <FaMagnifyingGlass aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("superadmin.console.searchPlaceholder")}
                aria-label={t("superadmin.console.searchLabel")}
              />
              {search ? (
                <button type="button" onClick={() => setSearch("")} aria-label={t("superadmin.console.clearSearch")}>
                  <FaXmark aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="sac__tabs ds-tabs" role="tablist" aria-label={t("superadmin.console.filterLabel")}>
              {FILTERS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.key}
                  className={`sac__tab ds-tab${filter === tab.key ? " is-active" : ""}`}
                  onClick={() => setFilter(tab.key)}
                >
                  {t(`superadmin.console.filters.${tab.key}`)}
                  <span className="sac__tab-count ds-tab__count">{counts[tab.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <StateBlock kind="loading" className="sac__stateblock" title={t("superadmin.console.loading")} />
          ) : !hasAnyAdmins ? (
            <StateBlock
              kind="empty"
              className="sac__stateblock"
              title={t("superadmin.console.emptyTitle")}
              description={t("superadmin.console.emptyDescription")}
              action={
                <button type="button" className="sac__primary" onClick={() => setProvisionOpen(true)}>
                  <FaUserPlus aria-hidden="true" /> {t("superadmin.console.provision")}
                </button>
              }
            />
          ) : filteredAdmins.length === 0 ? (
            <StateBlock
              kind="empty"
              className="sac__stateblock"
              title={t("superadmin.console.noMatchTitle")}
              description={
                search
                  ? t(filter !== "all" ? "superadmin.console.noMatchSearchInView" : "superadmin.console.noMatchSearch", {
                      query: search,
                    })
                  : t(filter !== "all" ? "superadmin.console.noMatchInView" : "superadmin.console.noMatch")
              }
              action={
                <button
                  type="button"
                  className="sac__ghost"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  {t("superadmin.console.clearFilters")}
                </button>
              }
            />
          ) : (
            <div className="sac__table-wrap" ref={tableRef}>
              <table className="sac__table">
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Identity / note</th>
                    <th>Status</th>
                    <th>Last active</th>
                    <th className="sac__th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((admin) => {
                    const status = statusOf(admin);
                    const invite = admin.invite || null;
                    const awaiting = isInviteStatus(status);
                    const waitSeconds = awaiting ? secondsUntil(invite && invite.nextResendAt) : 0;
                    const resendsLeft = invite ? invite.resendsLeft : inviteSettings.maxResends;
                    const rowBusy = busyId === admin.id;
                    const note = (admin.staffNote || "").trim();
                    return (
                      <tr key={admin.id} className={admin.isActive || awaiting ? "" : "is-disabled"}>
                        <td data-label="Staff member">
                          <div className="sac__member">
                            <span className="sac__avatar" aria-hidden="true">
                              {(admin.name || "?").charAt(0).toUpperCase()}
                            </span>
                            <span className="sac__member-text">
                              <strong>{admin.name}</strong>
                              <span>{admin.email}</span>
                            </span>
                          </div>
                        </td>
                        <td data-label="Identity / note">
                          {note ? (
                            NOTE_PRESETS.includes(note) ? (
                              <span className="sac__note-pill">{note}</span>
                            ) : (
                              <span className="sac__note" title={note}>{note}</span>
                            )
                          ) : (
                            <span className="sac__note-empty">—</span>
                          )}
                        </td>
                        <td data-label="Status">
                          <div className="si-status">
                            {status === "pendingPassword" ? (
                              <span className="sac-badge sac-badge--pending">Pending OTP</span>
                            ) : (
                              <AccountStatusBadge state={BADGE_STATE[status]}>
                                {t(`staffInvite.status.${status}`)}
                              </AccountStatusBadge>
                            )}
                            {awaiting && invite && invite.emailStatus ? (
                              <span className={`si-mail si-mail--${invite.emailStatus}`}>
                                <span className="si-mail__mark" aria-hidden="true">
                                  {invite.emailStatus === "failed" ? "✕" : invite.emailStatus === "sent" ? "✓" : "…"}
                                </span>
                                {t(`staffInvite.email.${invite.emailStatus}`)}
                              </span>
                            ) : null}
                            {invite ? (
                              <details className="si-details">
                                <summary aria-label={t("staffInvite.actions.detailsFor", { name: admin.name })}>
                                  {t("staffInvite.actions.details")}
                                </summary>
                                <dl>
                                  <dt>{t("staffInvite.details.sent")}</dt>
                                  <dd>{formatWhen(invite.sentAt)}</dd>
                                  <dt>{t(status === "expired" ? "staffInvite.details.expiredOn" : "staffInvite.details.expires")}</dt>
                                  <dd>{formatWhen(invite.expiresAt)}</dd>
                                  <dt>{t("staffInvite.details.resends")}</dt>
                                  <dd>
                                    {t("staffInvite.details.resendsOf", {
                                      used: invite.resendCount,
                                      max: invite.resendCount + resendsLeft,
                                    })}
                                  </dd>
                                  <dt>{t("staffInvite.details.activated")}</dt>
                                  <dd>{invite.activatedAt ? formatWhen(invite.activatedAt) : t("staffInvite.details.none")}</dd>
                                </dl>
                              </details>
                            ) : null}
                          </div>
                        </td>
                        <td data-label="Last active" className="sac__lastactive">
                          {formatDate(admin.lastLoginAt)}
                        </td>
                        <td data-label="Actions">
                          <div className="sac__row-actions">
                            {awaiting ? (
                              <>
                                <button
                                  type="button"
                                  className="sac__icon-btn sac__icon-btn--invite"
                                  onClick={() => doResend(admin)}
                                  disabled={rowBusy || waitSeconds > 0 || resendsLeft <= 0}
                                  title={t("staffInvite.actions.resend")}
                                  aria-label={t("staffInvite.actions.resendFor", { name: admin.name })}
                                >
                                  <FaPaperPlane aria-hidden="true" />
                                </button>
                                {waitSeconds > 0 ? (
                                  <span className="si-wait" role="status">
                                    {t("staffInvite.actions.resendWait", { seconds: waitSeconds })}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="sac__icon-btn sac__icon-btn--disable sac__icon-btn--invite"
                                  onClick={() => requestCancelInvite(admin)}
                                  disabled={rowBusy}
                                  title={t("staffInvite.actions.cancel")}
                                  aria-label={t("staffInvite.actions.cancelFor", { name: admin.name })}
                                >
                                  <FaTrashCan aria-hidden="true" />
                                </button>
                              </>
                            ) : (
                              <>
                            <button
                              type="button"
                              className="sac__icon-btn sac__icon-btn--reset"
                              onClick={() => requestReset(admin)}
                              disabled={rowBusy}
                              title="Reset password — issues a new one-time password"
                              aria-label={`Reset password for ${admin.name}`}
                            >
                              <FaKey />
                            </button>
                            {admin.isActive ? (
                              <button
                                type="button"
                                className="sac__icon-btn sac__icon-btn--disable"
                                onClick={() => requestDisable(admin)}
                                disabled={rowBusy}
                                title="Disable account — blocks sign-in, keeps data"
                                aria-label={`Disable ${admin.name}`}
                              >
                                <FaBan />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="sac__icon-btn sac__icon-btn--enable"
                                onClick={() => doToggleActive(admin, true)}
                                disabled={rowBusy}
                                title="Re-enable account"
                                aria-label={`Enable ${admin.name}`}
                              >
                                <FaCircleCheck />
                              </button>
                            )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            {...pager.paginationProps}
            idPrefix="sac-admins"
            label={t("pagination.items.accounts")}
            scrollTargetRef={tableRef}
          />
        </section>
      </main>

      {/* ── Provision staff account (emailed invitation, no password) ── */}
      <ProvisionStaffModal
        isOpen={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        onProvisioned={handleProvisioned}
        expiryHours={inviteSettings.expiryHours}
      />

      {/* ── One-time password modal ───────────────────────────── */}
      {issued ? (
        <div className="sac__overlay" role="dialog" aria-modal="true" aria-labelledby="sac-otp-title">
          <div className="sac__modal">
            <div className="sac__modal-icon"><FaKey /></div>
            <h3 id="sac-otp-title">Temporary password reissued</h3>
            <p className="sac__modal-lead">
              Share this one-time password with <b>{issued.email}</b>. They will be required to change
              it on first sign-in.
            </p>

            <div className="sac__cred">
              <div className="sac__cred-row">
                <span>Email</span>
                <code>{issued.email}</code>
              </div>
              <div className="sac__cred-row">
                <span>Temporary password</span>
                <code className="sac__cred-pw">{issued.tempPassword}</code>
              </div>
            </div>

            <p className="sac__modal-warn">
              <FaTriangleExclamation /> This password is shown only once. If it is lost, use
              “Reset password” to issue a new one.
            </p>

            <div className="sac__modal-actions">
              <button type="button" className="sac__primary" onClick={copyCredentials}>
                {copied ? <FaCheck /> : <FaCopy />} {copied ? "Copied" : "Copy credentials"}
              </button>
              <button type="button" className="sac__ghost" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Destructive-action confirmation ───────────────────── */}
      {confirmState ? (
        <div
          className="sac__overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sac-confirm-title"
        >
          <div className="sac__modal">
            <div className={`sac__modal-icon sac__modal-icon--${confirmState.tone}`}>
              <FaTriangleExclamation />
            </div>
            <h3 id="sac-confirm-title">{confirmState.title}</h3>
            <p className="sac__modal-lead">{confirmState.message}</p>
            <div className="sac__modal-actions">
              <button
                type="button"
                className={`sac__primary${
                  confirmState.tone === "danger" ? " sac__primary--danger" : " sac__primary--warn"
                }`}
                onClick={runConfirm}
              >
                {confirmState.confirmLabel}
              </button>
              <button type="button" className="sac__ghost" onClick={() => setConfirmState(null)}>
                {confirmState.cancelLabel || "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
