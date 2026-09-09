import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-icons/fa6";
import { superadminAPI } from "../../services/api";
import "../../styles/superadmin-console.css";

const NOTE_PRESETS = [
  "PESO Manager",
  "NSRP Data Encoder",
  "SPES Coordinator",
  "Employer Verification Officer",
  "Job Fair Coordinator",
];

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

const statusOf = (admin) => {
  if (!admin.isActive) return "disabled";
  if (admin.mustChangePassword) return "pending";
  return "active";
};

const STATUS_META = {
  active: { label: "Active", className: "sac-badge--active" },
  pending: { label: "Pending OTP", className: "sac-badge--pending" },
  disabled: { label: "Disabled", className: "sac-badge--disabled" },
};

export default function SuperadminConsole() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ name: "", email: "", staffNote: "" });
  const [creating, setCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The last one-time password issued (on create or reset). Shown once, in a modal.
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
  useEffect(() => {
    const anyOverlay = drawerOpen || Boolean(issued) || Boolean(confirmState);
    if (!anyOverlay) return undefined;

    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (confirmState) setConfirmState(null);
      else if (issued) setIssued(null);
      else if (!creating) setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen, issued, confirmState, creating]);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const applyPreset = (label) =>
    setForm((f) => ({ ...f, staffNote: f.staffNote.trim() === label ? "" : label }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const { data } = await superadminAPI.createAdmin({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        staffNote: form.staffNote.trim(),
      });
      setIssued({ email: data.admin.email, tempPassword: data.tempPassword, context: "created" });
      setCopied(false);
      setForm({ name: "", email: "", staffNote: "" });
      setDrawerOpen(false);
      await loadAdmins();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not create the admin account.");
    } finally {
      setCreating(false);
    }
  };

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
      pending: admins.filter((a) => statusOf(a) === "pending").length,
      disabled: admins.filter((a) => statusOf(a) === "disabled").length,
    }),
    [admins]
  );

  const filteredAdmins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return admins.filter((admin) => {
      if (filter !== "all" && statusOf(admin) !== filter) return false;
      if (!q) return true;
      return (
        (admin.name || "").toLowerCase().includes(q) ||
        (admin.email || "").toLowerCase().includes(q) ||
        (admin.staffNote || "").toLowerCase().includes(q)
      );
    });
  }, [admins, search, filter]);

  const hasAnyAdmins = admins.length > 0;

  return (
    <div className="sac">
      <main className="sac__main">
        <header className="sac__pagehead">
          <span className="sac__pagehead-icon"><FaUserShield /></span>
          <div>
            <h1>Superadmin Console</h1>
            <p>Provision and manage LMDPESO admin accounts</p>
          </div>
        </header>

        {error ? (
          <div className="sac__error" role="alert">
            <FaTriangleExclamation /> <span>{error}</span>
          </div>
        ) : null}

        <section className="sac__card sac__roster">
          <header className="sac__roster-head">
            <div className="sac__roster-heading">
              <h2><FaUserShield /> Managed Admin Accounts</h2>
              <span className="sac__count">{counts.all} total</span>
            </div>
            <button
              type="button"
              className="sac__primary sac__provision-trigger"
              onClick={() => setDrawerOpen(true)}
            >
              <FaUserPlus /> Provision New Admin
            </button>
          </header>

          <div className="sac__toolbar">
            <div className="sac__search">
              <FaMagnifyingGlass />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or note"
                aria-label="Search admin accounts"
              />
              {search ? (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                  <FaXmark />
                </button>
              ) : null}
            </div>
            <div className="sac__tabs" role="tablist" aria-label="Filter by status">
              {FILTERS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.key}
                  className={`sac__tab${filter === tab.key ? " is-active" : ""}`}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                  <span className="sac__tab-count">{counts[tab.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="sac__state">Loading admin accounts…</div>
          ) : !hasAnyAdmins ? (
            <div className="sac__state">
              <span className="sac__state-icon"><FaUserShield /></span>
              <strong>No admin accounts yet</strong>
              <p>Provision the first LMDPESO staff account to get started.</p>
              <button type="button" className="sac__primary" onClick={() => setDrawerOpen(true)}>
                <FaUserPlus /> Provision New Admin
              </button>
            </div>
          ) : filteredAdmins.length === 0 ? (
            <div className="sac__state">
              <span className="sac__state-icon"><FaMagnifyingGlass /></span>
              <strong>No matches</strong>
              <p>
                {search ? <>No accounts match “<b>{search}</b>”</> : "No accounts"}
                {filter !== "all" ? " in this view" : ""}.
              </p>
              <button
                type="button"
                className="sac__ghost"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="sac__table-wrap">
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
                  {filteredAdmins.map((admin) => {
                    const status = statusOf(admin);
                    const meta = STATUS_META[status];
                    const rowBusy = busyId === admin.id;
                    const note = (admin.staffNote || "").trim();
                    return (
                      <tr key={admin.id} className={admin.isActive ? "" : "is-disabled"}>
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
                          <span className={`sac-badge ${meta.className}`}>{meta.label}</span>
                        </td>
                        <td data-label="Last active" className="sac__lastactive">
                          {formatDate(admin.lastLoginAt)}
                        </td>
                        <td data-label="Actions">
                          <div className="sac__row-actions">
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
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* ── Slide-over: provisioning form ─────────────────────── */}
      {drawerOpen ? (
        <div
          className="sac__drawer-overlay"
          onClick={() => !creating && setDrawerOpen(false)}
        >
          <aside
            className="sac__drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sac-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sac__drawer-head">
              <h2 id="sac-drawer-title"><FaUserPlus /> Provision New Admin Account</h2>
              <button
                type="button"
                className="sac__drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
                disabled={creating}
              >
                <FaXmark />
              </button>
            </header>

            <p className="sac__drawer-lead">
              For LMDPESO office staff only. The account starts with a one-time password and the
              holder must set their own on first sign-in.
            </p>

            <form className="sac__form" onSubmit={handleCreate}>
              <label className="sac__field">
                <span>Full name</span>
                <input
                  name="name"
                  value={form.name}
                  onChange={onChange}
                  placeholder="Juan Dela Cruz"
                  autoComplete="off"
                  autoFocus
                  required
                  disabled={creating}
                />
              </label>

              <label className="sac__field">
                <span>PESO official email</span>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={onChange}
                  placeholder="name@peso.marinduque.gov.ph"
                  autoComplete="off"
                  required
                  disabled={creating}
                />
              </label>

              <label className="sac__field">
                <span>Purpose / identity note</span>
                <textarea
                  name="staffNote"
                  value={form.staffNote}
                  onChange={onChange}
                  placeholder="Who this is and their PESO position — e.g. 'Ma. Santos, PESO Manager'."
                  rows={3}
                  required
                  disabled={creating}
                />
              </label>

              <div className="sac__chips" role="group" aria-label="Quick-fill common roles">
                {NOTE_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    className={`sac__chip${form.staffNote.trim() === preset ? " is-active" : ""}`}
                    onClick={() => applyPreset(preset)}
                    disabled={creating}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <p className="sac__form-hint">
                <FaTriangleExclamation />
                A one-time password is generated on submit and shown once. It stops working the
                moment the new admin sets their own password.
              </p>

              <div className="sac__drawer-actions">
                <button
                  type="button"
                  className="sac__ghost"
                  onClick={() => setDrawerOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" className="sac__primary" disabled={creating}>
                  <FaUserPlus /> {creating ? "Generating…" : "Generate Admin Account"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {/* ── One-time password modal ───────────────────────────── */}
      {issued ? (
        <div className="sac__overlay" role="dialog" aria-modal="true" aria-labelledby="sac-otp-title">
          <div className="sac__modal">
            <div className="sac__modal-icon"><FaKey /></div>
            <h3 id="sac-otp-title">
              {issued.context === "created" ? "Admin account created" : "Temporary password reissued"}
            </h3>
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
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
