import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FaUserCog,
  FaLanguage,
  FaBell,
  FaUserShield,
  FaInfoCircle,
  FaLayerGroup,
  FaExclamationTriangle,
  FaSlidersH,
  FaClipboardList,
  FaChevronRight,
  FaArrowRight,
  FaTrashAlt,
  FaRegClock,
} from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { employerAPI, authAPI, superadminAPI } from "../services/api";
import { usePersistentState } from "../hooks/usePersistentState";
import { useToast, useConfirm } from "../components/feedback/context";
import "../styles/settings.css";

const normalizeRole = (role) =>
  role === "employee" || role === "resident" ? "jobseeker" : role;

// Fallback shape shown while the real values load from the server, and the
// baseline a partial server response is merged onto.
const NOTIFICATION_DEFAULTS = {
  notifyMessages: true,
  notifyJobMatch: true,
  notifyApplicationUpdate: true,
  notifyNewApplicant: true,
  notifyJobExpiring: true,
  notifyVerificationRequest: true,
  notifyUserReport: true,
  notifySpesSubmission: true,
};

const PRIVACY_DEFAULTS = {
  profileVisibility: "public",
  allowMessagesFrom: "anyone",
};

const SYSTEM_DEFAULTS = {
  autoCloseDays: 30,
  appealWindowDays: 14,
  requireEmployerVerification: true,
};

const SECTIONS_BY_ROLE = {
  jobseeker: ["account", "language", "notifications", "privacy", "about", "danger"],
  employer: ["account", "language", "templates", "notifications", "about", "danger"],
  admin: ["account", "notifications", "access", "about"],
  superadmin: ["account", "system", "admin-tools", "about"],
};

const SECTION_ICON = {
  account: <FaUserCog />,
  language: <FaLanguage />,
  templates: <FaLayerGroup />,
  notifications: <FaBell />,
  privacy: <FaUserShield />,
  access: <FaClipboardList />,
  system: <FaSlidersH />,
  "admin-tools": <FaClipboardList />,
  about: <FaInfoCircle />,
  danger: <FaExclamationTriangle />,
};

const SECTION_LABEL_KEY = {
  account: "account",
  language: "language",
  templates: "templates",
  notifications: "notifications",
  privacy: "privacy",
  access: "access",
  system: "system",
  "admin-tools": "adminTools",
  about: "about",
  danger: "danger",
};

function Toggle({ id, checked, onChange, label, hint, disabled }) {
  return (
    <label className={`set-toggle ${disabled ? "is-disabled" : ""}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="set-toggle__track" aria-hidden="true">
        <span className="set-toggle__thumb" />
      </span>
      <span className="set-toggle__text">
        <span className="set-toggle__label">{label}</span>
        {hint && <span className="set-toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { user, logout } = useContext(AuthContext);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const role = normalizeRole(user?.role) || "jobseeker";
  const sections = SECTIONS_BY_ROLE[role] || SECTIONS_BY_ROLE.jobseeker;

  // Scoped to the signed-in account — bare keys here would be shared by
  // every account that ever uses this browser, so a different account
  // signing in later could silently inherit someone else's unsaved
  // preference toggles.
  const currentUserId = user?._id || user?.id || null;
  const [activeSection, setActiveSection] = usePersistentState(
    currentUserId ? `settingsActiveSection_${currentUserId}` : null,
    { value: sections[0] }
  );
  const active = sections.includes(activeSection?.value)
    ? activeSection.value
    : sections[0];

  const go = (value) => setActiveSection({ value });

  // ── Notification preferences + privacy (jobseeker / employer / admin) ──
  const hasAccountSettings = ["jobseeker", "employer", "admin"].includes(role);
  const [notifPrefs, setNotifPrefs] = useState(NOTIFICATION_DEFAULTS);
  const [privacy, setPrivacy] = useState(PRIVACY_DEFAULTS);
  const [accountSettingsLoading, setAccountSettingsLoading] = useState(hasAccountSettings);

  useEffect(() => {
    if (!hasAccountSettings) return;
    let cancelled = false;
    setAccountSettingsLoading(true);
    authAPI
      .getSettings()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.notificationPreferences) {
          setNotifPrefs((prev) => ({ ...prev, ...data.notificationPreferences }));
        }
        if (data?.privacy) {
          setPrivacy((prev) => ({ ...prev, ...data.privacy }));
        }
      })
      .catch(() => {
        if (!cancelled) toast.error(t("settings.saveError"));
      })
      .finally(() => {
        if (!cancelled) setAccountSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccountSettings]);

  const saveNotificationPref = async (key, value) => {
    const previous = notifPrefs;
    setNotifPrefs((prev) => ({ ...prev, [key]: value }));
    try {
      await authAPI.updateSettings({ notificationPreferences: { [key]: value } });
    } catch {
      setNotifPrefs(previous);
      toast.error(t("settings.saveError"));
    }
  };

  const savePrivacyField = async (key, value) => {
    const previous = privacy;
    setPrivacy((prev) => ({ ...prev, [key]: value }));
    try {
      await authAPI.updateSettings({ privacy: { [key]: value } });
    } catch {
      setPrivacy(previous);
      toast.error(t("settings.saveError"));
    }
  };

  // ── System preferences (superadmin) ──
  const [systemSettings, setSystemSettings] = useState(SYSTEM_DEFAULTS);
  const [systemLoading, setSystemLoading] = useState(role === "superadmin");

  useEffect(() => {
    if (role !== "superadmin") return;
    let cancelled = false;
    setSystemLoading(true);
    superadminAPI
      .getSystemSettings()
      .then(({ data }) => {
        if (!cancelled && data) setSystemSettings((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {
        if (!cancelled) toast.error(t("settings.saveError"));
      })
      .finally(() => {
        if (!cancelled) setSystemLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const saveSystemField = async (patch) => {
    const previous = systemSettings;
    setSystemSettings((prev) => ({ ...prev, ...patch }));
    try {
      const { data } = await superadminAPI.updateSystemSettings(patch);
      setSystemSettings((prev) => ({ ...prev, ...data }));
    } catch {
      setSystemSettings(previous);
      toast.error(t("settings.saveError"));
    }
  };

  const displayName =
    user?.name ||
    [user?.firstName, user?.surname].filter(Boolean).join(" ") ||
    t("settings.account.yourAccount");

  return (
    <div className="set">
      <div className="set__main">
        <header className="set__pagehead">
          <span className="set__pagehead-icon">
            <FaUserCog />
          </span>
          <div>
            <h1>{t("settings.pageTitle")}</h1>
            <p>{t("settings.pageSubtitle")}</p>
          </div>
        </header>

        <div className="set__layout">
          <nav className="set__rail" aria-label={t("settings.railLabel")}>
            {sections.map((key) => (
              <button
                key={key}
                type="button"
                className={`set__rail-item ${active === key ? "is-active" : ""}`}
                onClick={() => go(key)}
              >
                <span className="set__rail-icon">{SECTION_ICON[key]}</span>
                <span>{t(`settings.sections.${SECTION_LABEL_KEY[key]}`)}</span>
              </button>
            ))}
          </nav>

          <div className="set__panel">
            {active === "account" && (
              <AccountSection role={role} user={user} displayName={displayName} />
            )}
            {active === "language" && <LanguageSection />}
            {active === "templates" && <TemplatesSection toast={toast} confirm={confirm} />}
            {active === "notifications" && (
              <NotificationsSection
                role={role}
                prefs={notifPrefs}
                loading={accountSettingsLoading}
                onToggle={saveNotificationPref}
              />
            )}
            {active === "privacy" && (
              <PrivacySection
                privacy={privacy}
                loading={accountSettingsLoading}
                onChange={savePrivacyField}
              />
            )}
            {active === "access" && <AccessSection role={role} />}
            {active === "system" && (
              <SystemSection
                system={systemSettings}
                loading={systemLoading}
                onSave={saveSystemField}
              />
            )}
            {active === "admin-tools" && <AdminToolsSection />}
            {active === "about" && <AboutSection />}
            {active === "danger" && (
              <DangerSection confirm={confirm} toast={toast} logout={logout} navigate={navigate} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────── */

function SectionHead({ title, subtitle }) {
  return (
    <div className="set-card__head">
      <div>
        <h2 className="set-card__title">{title}</h2>
        {subtitle && <p className="set-card__subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}

function AccountSection({ role, user, displayName }) {
  const { t } = useTranslation();
  const roleLabel = t(`settings.roles.${role}`, { defaultValue: role });
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.account.title")}
        subtitle={t("settings.account.subtitle")}
      />
      <dl className="set-kv">
        <div>
          <dt>{t("settings.account.name")}</dt>
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>{t("settings.account.email")}</dt>
          <dd>{user?.email || "—"}</dd>
        </div>
        <div>
          <dt>{t("settings.account.phone")}</dt>
          <dd>{user?.phone || "—"}</dd>
        </div>
        {role === "employer" && (
          <div>
            <dt>{t("settings.account.company")}</dt>
            <dd>{user?.companyName || "—"}</dd>
          </div>
        )}
        <div>
          <dt>{t("settings.account.role")}</dt>
          <dd>
            <span className="set-rolebadge">{roleLabel}</span>
          </dd>
        </div>
      </dl>
      <div className="set-actions">
        <Link to="/profile/edit" className="set-btn set-btn--primary">
          {t("settings.account.editFullProfile")} <FaArrowRight aria-hidden="true" />
        </Link>
        <Link to="/profile" className="set-btn set-btn--ghost">
          {t("settings.account.viewProfile")}
        </Link>
      </div>
      <p className="set-hint">{t("settings.account.hint")}</p>
    </section>
  );
}

function LanguageSection() {
  const { t, i18n } = useTranslation();
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.language.title")}
        subtitle={t("settings.language.subtitle")}
      />
      <label className="set-field">
        <span className="set-field__label">{t("settings.language.displayLanguage")}</span>
        <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
          <option value="en">{t("settings.language.english")}</option>
          <option value="fil">{t("settings.language.filipino")}</option>
        </select>
      </label>
      <p className="set-hint">{t("settings.language.hint")}</p>
    </section>
  );
}

function TemplatesSection({ toast, confirm }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await employerAPI.getQualificationTemplates();
      const all = Array.isArray(res.data?.templates) ? res.data.templates : [];
      setTemplates(all.filter((item) => item.source === "custom"));
    } catch {
      setError(t("settings.templates.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (tpl) => {
    const ok = await confirm({
      title: t("settings.templates.deleteConfirmTitle", { name: tpl.name }),
      message: t("settings.templates.deleteConfirmMessage"),
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await employerAPI.deleteQualificationTemplate(tpl.id);
      setTemplates((prev) => prev.filter((item) => item.id !== tpl.id));
      toast.success(t("settings.templates.deleted"));
    } catch {
      toast.error(t("settings.templates.deleteError"));
    }
  };

  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.templates.title")}
        subtitle={t("settings.templates.subtitle")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}
      {error && !loading && <p className="set-error">{error}</p>}

      {!loading && !error && templates.length === 0 && (
        <p className="set-empty">
          {t("settings.templates.emptyPrefix")}{" "}
          <strong>{t("settings.templates.saveAsTemplate")}</strong>{" "}
          {t("settings.templates.emptySuffix")}
        </p>
      )}

      {!loading && templates.length > 0 && (
        <ul className="set-tpl-list">
          {templates.map((tpl) => (
            <li key={tpl.id} className="set-tpl">
              <div className="set-tpl__body">
                <span className="set-tpl__name">{tpl.name}</span>
                {tpl.jobTitle && (
                  <span className="set-tpl__hint">for “{tpl.jobTitle}”</span>
                )}
                <span className="set-tpl__meta">
                  {t("settings.templates.itemCount", { count: tpl.items.length })}
                  {tpl.updatedAt && (
                    <>
                      {" · "}
                      <FaRegClock aria-hidden="true" />{" "}
                      {new Date(tpl.updatedAt).toLocaleDateString()}
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="set-btn set-btn--danger-ghost"
                onClick={() => handleDelete(tpl)}
              >
                <FaTrashAlt aria-hidden="true" /> {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="set-hint">
        {t("settings.templates.hintPrefix")} <Link to="/post-job">{t("navbar.postVacancy")}</Link>{" "}
        {t("settings.templates.hintSuffix")}
      </p>

      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">{t("settings.templates.jobPostingTemplatesTitle")}</span>
          <span className="set-subrow__hint">{t("settings.templates.jobPostingTemplatesHint")}</span>
        </div>
        <span className="set-comingsoon">{t("common.comingSoon")}</span>
      </div>
    </section>
  );
}

function NotificationsSection({ role, prefs, loading, onToggle }) {
  const { t } = useTranslation();
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.notifications.title")}
        subtitle={t("settings.notifications.subtitle")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}

      <div className="set-toggle-group">
        {role === "jobseeker" && (
          <>
            <Toggle
              id="n-msg"
              checked={prefs.notifyMessages}
              disabled={loading}
              onChange={(v) => onToggle("notifyMessages", v)}
              label={t("settings.notifications.newMessages")}
              hint={t("settings.notifications.newMessagesHint")}
            />
            <Toggle
              id="n-match"
              checked={prefs.notifyJobMatch}
              disabled={loading}
              onChange={(v) => onToggle("notifyJobMatch", v)}
              label={t("settings.notifications.jobMatches")}
              hint={t("settings.notifications.jobMatchesHint")}
            />
            <Toggle
              id="n-appupd"
              checked={prefs.notifyApplicationUpdate}
              disabled={loading}
              onChange={(v) => onToggle("notifyApplicationUpdate", v)}
              label={t("settings.notifications.applicationUpdates")}
              hint={t("settings.notifications.applicationUpdatesHint")}
            />
          </>
        )}
        {role === "employer" && (
          <>
            <Toggle
              id="n-applicant"
              checked={prefs.notifyNewApplicant}
              disabled={loading}
              onChange={(v) => onToggle("notifyNewApplicant", v)}
              label={t("settings.notifications.newApplicants")}
              hint={t("settings.notifications.newApplicantsHint")}
            />
            <Toggle
              id="n-expiring"
              checked={prefs.notifyJobExpiring}
              disabled={loading}
              onChange={(v) => onToggle("notifyJobExpiring", v)}
              label={t("settings.notifications.vacancyExpiring")}
              hint={t("settings.notifications.vacancyExpiringHint")}
            />
          </>
        )}
        {role === "admin" && (
          <>
            <Toggle
              id="n-verif"
              checked={prefs.notifyVerificationRequest}
              disabled={loading}
              onChange={(v) => onToggle("notifyVerificationRequest", v)}
              label={t("settings.notifications.verificationRequests")}
              hint={t("settings.notifications.verificationRequestsHint")}
            />
            <Toggle
              id="n-report"
              checked={prefs.notifyUserReport}
              disabled={loading}
              onChange={(v) => onToggle("notifyUserReport", v)}
              label={t("settings.notifications.userReports")}
              hint={t("settings.notifications.userReportsHint")}
            />
            <Toggle
              id="n-spes"
              checked={prefs.notifySpesSubmission}
              disabled={loading}
              onChange={(v) => onToggle("notifySpesSubmission", v)}
              label={t("settings.notifications.spesSubmissions")}
              hint={t("settings.notifications.spesSubmissionsHint")}
            />
          </>
        )}
      </div>
    </section>
  );
}

function PrivacySection({ privacy, loading, onChange }) {
  const { t } = useTranslation();
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.privacy.title")}
        subtitle={t("settings.privacy.subtitle")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}

      <label className="set-field">
        <span className="set-field__label">{t("settings.privacy.profileVisibility")}</span>
        <select
          value={privacy.profileVisibility}
          disabled={loading}
          onChange={(e) => onChange("profileVisibility", e.target.value)}
        >
          <option value="public">{t("settings.privacy.visibilityPublic")}</option>
          <option value="employers">{t("settings.privacy.visibilityEmployers")}</option>
          <option value="hidden">{t("settings.privacy.visibilityHidden")}</option>
        </select>
      </label>

      <label className="set-field">
        <span className="set-field__label">{t("settings.privacy.whoCanMessage")}</span>
        <select
          value={privacy.allowMessagesFrom}
          disabled={loading}
          onChange={(e) => onChange("allowMessagesFrom", e.target.value)}
        >
          <option value="anyone">{t("settings.privacy.messageAnyone")}</option>
          <option value="employers">{t("settings.privacy.messageEmployers")}</option>
        </select>
      </label>
    </section>
  );
}

function AccessSection({ role }) {
  const { t } = useTranslation();
  const modules = t(
    role === "superadmin" ? "settings.access.superadminModules" : "settings.access.adminModules",
    { returnObjects: true }
  );
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.access.title")}
        subtitle={t("settings.access.subtitle")}
      />
      <ul className="set-list">
        {modules.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="set-hint">{t("settings.access.hint")}</p>
    </section>
  );
}

function SystemSection({ system, loading, onSave }) {
  const { t } = useTranslation();
  // Local typing buffers for the two number fields, so keystrokes stay
  // smooth and the network save only fires once the field is committed
  // (blur), not on every keystroke.
  const [autoCloseDraft, setAutoCloseDraft] = useState(String(system.autoCloseDays));
  const [appealWindowDraft, setAppealWindowDraft] = useState(String(system.appealWindowDays));
  // Re-sync the typing buffers when the underlying value changes from outside
  // this component (initial load, or a revert after a failed save) — done
  // during render (React's documented "adjusting state on prop change"
  // pattern), not in an effect, so it doesn't cause an extra render pass.
  const [syncedAutoClose, setSyncedAutoClose] = useState(system.autoCloseDays);
  if (system.autoCloseDays !== syncedAutoClose) {
    setSyncedAutoClose(system.autoCloseDays);
    setAutoCloseDraft(String(system.autoCloseDays));
  }
  const [syncedAppealWindow, setSyncedAppealWindow] = useState(system.appealWindowDays);
  if (system.appealWindowDays !== syncedAppealWindow) {
    setSyncedAppealWindow(system.appealWindowDays);
    setAppealWindowDraft(String(system.appealWindowDays));
  }

  const commitAutoClose = () => {
    const clamped = Math.min(365, Math.max(1, Math.round(Number(autoCloseDraft)) || system.autoCloseDays));
    setAutoCloseDraft(String(clamped));
    if (clamped !== system.autoCloseDays) onSave({ autoCloseDays: clamped });
  };

  const commitAppealWindow = () => {
    const clamped = Math.min(90, Math.max(1, Math.round(Number(appealWindowDraft)) || system.appealWindowDays));
    setAppealWindowDraft(String(clamped));
    if (clamped !== system.appealWindowDays) onSave({ appealWindowDays: clamped });
  };

  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.system.title")}
        subtitle={t("settings.system.subtitle")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}

      <label className="set-field">
        <span className="set-field__label">{t("settings.system.autoCloseLabel")}</span>
        <div className="set-field__inline">
          <input
            type="number"
            min="1"
            max="365"
            value={autoCloseDraft}
            disabled={loading}
            onChange={(e) => setAutoCloseDraft(e.target.value)}
            onBlur={commitAutoClose}
          />
          <span>{t("settings.system.autoCloseSuffix")}</span>
        </div>
      </label>

      <label className="set-field">
        <span className="set-field__label">{t("settings.system.appealWindowLabel")}</span>
        <div className="set-field__inline">
          <input
            type="number"
            min="1"
            max="90"
            value={appealWindowDraft}
            disabled={loading}
            onChange={(e) => setAppealWindowDraft(e.target.value)}
            onBlur={commitAppealWindow}
          />
          <span>{t("settings.system.appealWindowSuffix")}</span>
        </div>
      </label>

      <div className="set-toggle-group">
        <Toggle
          id="s-verif"
          checked={system.requireEmployerVerification}
          disabled={loading}
          onChange={(v) => onSave({ requireEmployerVerification: v })}
          label={t("settings.system.requireVerification")}
          hint={t("settings.system.requireVerificationHint")}
        />
      </div>
    </section>
  );
}

function AdminToolsSection() {
  const { t } = useTranslation();
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.adminTools.title")}
        subtitle={t("settings.adminTools.subtitle")}
      />
      <div className="set-linklist">
        <Link to="/superadmin" className="set-linkrow">
          <span>
            <strong>{t("settings.adminTools.superadminConsole")}</strong>
            <small>{t("settings.adminTools.superadminConsoleHint")}</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
        <Link to="/admin/users" className="set-linkrow">
          <span>
            <strong>{t("settings.adminTools.userManagement")}</strong>
            <small>{t("settings.adminTools.userManagementHint")}</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
        <Link to="/admin/audit-logs" className="set-linkrow">
          <span>
            <strong>{t("settings.adminTools.auditTrail")}</strong>
            <small>{t("settings.adminTools.auditTrailHint")}</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.about.title")}
        subtitle={t("settings.about.subtitle")}
      />
      <p className="set-prose">{t("settings.about.body")}</p>
      <div className="set-actions">
        <Link to="/about" className="set-btn set-btn--primary">
          {t("settings.about.viewFullAboutPage")} <FaArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function DangerSection({ confirm, toast, logout, navigate }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [deactivating, setDeactivating] = useState(false);

  const handleDeactivate = async () => {
    if (!password) {
      toast.error(t("settings.danger.passwordRequired"));
      return;
    }

    const ok = await confirm({
      title: t("settings.danger.confirmTitle"),
      message: t("settings.danger.confirmMessage"),
      tone: "danger",
      confirmLabel: t("settings.danger.confirmLabel"),
    });
    if (!ok) return;

    setDeactivating(true);
    try {
      const { data } = await authAPI.deactivateAccount(password);
      toast.success(data?.message || t("settings.danger.deactivateSuccess"));
      logout();
      navigate("/login");
    } catch (err) {
      toast.error(err?.response?.data?.message || t("settings.danger.deactivateError"));
      setDeactivating(false);
    }
  };

  return (
    <section className="set-card set-card--danger">
      <SectionHead
        title={t("settings.danger.title")}
        subtitle={t("settings.danger.subtitle")}
      />
      <p className="set-prose">{t("settings.danger.body")}</p>

      <label className="set-field">
        <span className="set-field__label">{t("settings.danger.passwordLabel")}</span>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder={t("settings.danger.passwordPlaceholder")}
          disabled={deactivating}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <div className="set-actions">
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={handleDeactivate}
          disabled={deactivating}
        >
          {deactivating ? t("common.loading") : t("settings.danger.deactivateButton")}
        </button>
      </div>
    </section>
  );
}
