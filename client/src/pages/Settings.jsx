import { formatPhoneDisplay } from "../utils/phoneIntl";
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
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
  FaArrowLeft,
  FaTrashAlt,
  FaRegClock,
  FaDownload,
  FaQuestionCircle,
} from "react-icons/fa";
import { AuthContext } from "../context/AuthContext";
import { employerAPI, authAPI, superadminAPI } from "../services/api";
import { useNavbarStylePreference } from "../hooks/useNavbarStylePreference";
import { useToast, useConfirm } from "../components/feedback/context";
import GoogleSignInButton from "../components/GoogleSignInButton";
import IdOcrReview from "../components/IdOcrReview";
import MatchWeightDefaultsSettings from "../components/MatchWeightDefaultsSettings";
import PesoHelpFloatingToggle from "../chatbot/ui/PesoHelpFloatingToggle";
import { backupCodesFilename, buildBackupCodesText, downloadTextFile, localDateStamp } from "../utils/backupCodesFile";
import { needsEmail } from "../utils/usernameSignup";
import { openEmailPrompt } from "../utils/emailNudge";
// GoogleSignInButton's own base layout rules (.google-signin / __divider /
// __btn) live here rather than in settings.css. Importing it explicitly
// (instead of relying on it happening to already be loaded by some other
// page) keeps the "Add a password" card correctly laid out even if Settings
// is ever route-split away from pages that import this directly.
import "../styles/auth.css";
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
  notifyAccountRecovery: true,
};

// Same categories as NOTIFICATION_DEFAULTS (in-app), plus the "emailAll"
// master switch — a second, independent channel. See
// server/models/User.js's emailNotificationPreferences and
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §1.
const EMAIL_NOTIFICATION_DEFAULTS = {
  emailAll: true,
  ...NOTIFICATION_DEFAULTS,
};

const PRIVACY_DEFAULTS = {
  profileVisibility: "public",
  allowMessagesFrom: "anyone",
  // "Show my active status": on unless the user turned it off.
  showActiveStatus: true,
};

const SYSTEM_DEFAULTS = {
  autoCloseDays: 30,
  appealWindowDays: 14,
  requireEmployerVerification: true,
  deletedAccountGraceDays: 30,
  staffInviteExpiryHours: 48,
  staffInviteResendCooldownSeconds: 60,
};

const SECTIONS_BY_ROLE = {
  jobseeker: ["account", "language", "notifications", "privacy", "system", "peso-help", "about", "danger"],
  employer: ["account", "language", "templates", "notifications", "privacy", "system", "peso-help", "about", "danger"],
  admin: ["account", "notifications", "privacy", "access", "matching", "system", "about"],
  superadmin: ["account", "privacy", "matching", "system", "admin-tools", "about"],
};

const SECTION_ICON = {
  account: <FaUserCog />,
  language: <FaLanguage />,
  templates: <FaLayerGroup />,
  notifications: <FaBell />,
  privacy: <FaUserShield />,
  access: <FaClipboardList />,
  system: <FaSlidersH />,
  matching: <FaSlidersH />,
  "peso-help": <FaQuestionCircle />,
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
  matching: "matching",
  "peso-help": "pesoHelp",
  "admin-tools": "adminTools",
  about: "about",
  danger: "danger",
};

// From 1024px Settings shows a persistent sub-navigation beside the open
// section (and opens the first section by default); below that it keeps the
// list-first flow. Read through useSyncExternalStore so the layout follows
// the viewport without an effect that sets state.
const WIDE_QUERY = "(min-width: 1024px)";
const subscribeWide = (onChange) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const getWide = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia) && window.matchMedia(WIDE_QUERY).matches;
const getWideServer = () => false;

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

// A notification category with its own switch per channel (in-app / email) —
// the two are independent preferences (see
// server/services/notificationService.js's queueNotificationEmail: an event
// a recipient has turned off in-app is never emailed either, but email can
// still be turned off separately while in-app stays on). The switches sit in
// their own flex cluster that wraps onto its own line below the label/hint
// text once the row gets too narrow for both (phones, a resized window, a
// rotated screen) — not a fixed breakpoint, so it holds at any width.
function DualToggle({
  id,
  label,
  hint,
  inAppChecked,
  emailChecked,
  onInAppChange,
  onEmailChange,
  disabled,
  // Extra condition disabling ONLY the email switch (e.g. the "emailAll"
  // master switch below is off) — the in-app switch stays usable either way.
  emailDisabled = false,
}) {
  const { t } = useTranslation();
  const emailSwitchDisabled = disabled || emailDisabled;
  return (
    <div className={`set-dualtoggle ${disabled ? "is-disabled" : ""}`}>
      <span className="set-toggle__text">
        <span className="set-toggle__label">{label}</span>
        {hint && <span className="set-toggle__hint">{hint}</span>}
      </span>
      <div className="set-dualtoggle__switches">
        <label className={`set-toggle set-dualtoggle__switch ${disabled ? "is-disabled" : ""}`} htmlFor={`${id}-app`}>
          <input
            id={`${id}-app`}
            type="checkbox"
            checked={inAppChecked}
            disabled={disabled}
            onChange={(e) => onInAppChange(e.target.checked)}
          />
          <span className="set-toggle__track" aria-hidden="true">
            <span className="set-toggle__thumb" />
          </span>
          <span className="set-dualtoggle__switch-label">{t("settings.notifications.channelInApp")}</span>
        </label>
        <label
          className={`set-toggle set-dualtoggle__switch ${emailSwitchDisabled ? "is-disabled" : ""}`}
          htmlFor={`${id}-email`}
        >
          <input
            id={`${id}-email`}
            type="checkbox"
            checked={emailChecked}
            disabled={emailSwitchDisabled}
            onChange={(e) => onEmailChange(e.target.checked)}
          />
          <span className="set-toggle__track" aria-hidden="true">
            <span className="set-toggle__thumb" />
          </span>
          <span className="set-dualtoggle__switch-label">{t("settings.notifications.channelEmail")}</span>
        </label>
      </div>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { user, setUser, logout } = useContext(AuthContext);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const role = normalizeRole(user?.role) || "jobseeker";
  const sections = SECTIONS_BY_ROLE[role] || SECTIONS_BY_ROLE.jobseeker;

  const currentUserId = user?._id || user?.id || null;
  const [navbarStyle, setNavbarStyle] = useNavbarStylePreference(currentUserId);

  // List-first: entering Settings always shows the row list, never jumps
  // straight into a remembered section — `null` is that list view. A
  // section only becomes active once its row is tapped, and if it's no
  // longer valid (e.g. the signed-in role changed) this falls back to the
  // list instead of forcing some other section open.
  const [activeSection, setActiveSection] = useState(null);
  const active = activeSection && sections.includes(activeSection) ? activeSection : null;
  // Wide screens never show an empty detail area: with nothing picked yet
  // the first section of this role is shown. Nothing is stored, so going
  // back below 1024px still lands on the list.
  const isWide = useSyncExternalStore(subscribeWide, getWide, getWideServer);
  const current = active || (isWide ? sections[0] : null);

  const go = (key) => setActiveSection(key);
  const goBack = () => setActiveSection(null);

  // ── Notification preferences + privacy (jobseeker / employer / admin) ──
  const hasAccountSettings = ["jobseeker", "employer", "admin", "superadmin"].includes(role);
  const [notifPrefs, setNotifPrefs] = useState(NOTIFICATION_DEFAULTS);
  const [emailNotifPrefs, setEmailNotifPrefs] = useState(EMAIL_NOTIFICATION_DEFAULTS);
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
        if (data?.emailNotificationPreferences) {
          setEmailNotifPrefs((prev) => ({ ...prev, ...data.emailNotificationPreferences }));
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

  const saveEmailNotificationPref = async (key, value) => {
    const previous = emailNotifPrefs;
    setEmailNotifPrefs((prev) => ({ ...prev, [key]: value }));
    try {
      await authAPI.updateSettings({ emailNotificationPreferences: { [key]: value } });
    } catch {
      setEmailNotifPrefs(previous);
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
      toast.error(key === "showActiveStatus" ? t("settings.privacy.activeStatusError") : t("settings.saveError"));
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

  // "System Preferences" means something different depending on who's
  // looking: a personal sidebar preference for everyone, plus portal-wide
  // policy for superadmins only (see SystemSection below) — so its list-row
  // blurb can't just reuse the same settings.system.subtitle every section
  // otherwise gets, or non-superadmins would read a description of a
  // section they can't even see.
  const sectionSubtitle = (key) => {
    if (key === "system") {
      return role === "superadmin" ? t("settings.system.subtitle") : t("settings.system.navbarSubtitle");
    }
    return t(`settings.${SECTION_LABEL_KEY[key]}.subtitle`);
  };

  return (
    <div className="set st-page">
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

        <div className={`set__layout${isWide ? " set__layout--split" : ""}`}>
        {isWide || !current ? (
          <nav className="set__list" aria-label={t("settings.railLabel")}>
            {isWide ? <h2 className="set__subnav-title">{t("settings.subnavTitle")}</h2> : null}
            {sections.map((key) => key === "peso-help" ? (
              // Not an in-page section: PESO Help is its own page (/settings/peso-help).
              <Link key={key} to="/settings/peso-help" className="set__list-item">
                <span className="set__list-icon">{SECTION_ICON[key]}</span>
                <span className="set__list-text">
                  <span className="set__list-title">{t(`settings.sections.${SECTION_LABEL_KEY[key]}`)}</span>
                  <span className="set__list-desc">{sectionSubtitle(key)}</span>
                </span>
                <FaChevronRight className="set__list-chevron" aria-hidden="true" />
              </Link>
            ) : (
              <button
                key={key}
                type="button"
                className={`set__list-item${key === "danger" ? " set__list-item--danger" : ""}${isWide && key === current ? " is-active" : ""}`}
                aria-current={isWide && key === current ? "true" : undefined}
                onClick={() => go(key)}
              >
                <span className="set__list-icon">{SECTION_ICON[key]}</span>
                <span className="set__list-text">
                  <span className="set__list-title">{t(`settings.sections.${SECTION_LABEL_KEY[key]}`)}</span>
                  <span className="set__list-desc">{sectionSubtitle(key)}</span>
                </span>
                <FaChevronRight className="set__list-chevron" aria-hidden="true" />
              </button>
            ))}
          </nav>
        ) : null}

        {current ? (
          <div className="set__detail">
            {!isWide ? (
              <button type="button" className="set__back" onClick={goBack}>
                <FaArrowLeft aria-hidden="true" /> {t("settings.backToList")}
              </button>
            ) : null}

            <div className="set__panel">
              {current === "account" && (
                <AccountSection
                  role={role}
                  user={user}
                  displayName={displayName}
                  toast={toast}
                  confirm={confirm}
                  onPasswordAdded={() =>
                    setUser((prev) => (prev ? { ...prev, hasPassword: true } : prev))
                  }
                  onUsernameChanged={(username) =>
                    setUser((prev) => (prev ? { ...prev, username } : prev))
                  }
                />
              )}
              {current === "language" && <LanguageSection />}
              {current === "templates" && <TemplatesSection toast={toast} confirm={confirm} />}
              {current === "notifications" && (
                <NotificationsSection
                  role={role}
                  prefs={notifPrefs}
                  emailPrefs={emailNotifPrefs}
                  loading={accountSettingsLoading}
                  onToggle={saveNotificationPref}
                  onEmailToggle={saveEmailNotificationPref}
                />
              )}
              {current === "privacy" && (
                <PrivacySection
                  role={role}
                  privacy={privacy}
                  loading={accountSettingsLoading}
                  onChange={savePrivacyField}
                />
              )}
              {current === "access" && <AccessSection role={role} />}
              {current === "matching" && <MatchWeightDefaultsSettings />}
              {current === "system" && (
                <SystemSection
                  role={role}
                  navbarStyle={navbarStyle}
                  onNavbarStyleChange={setNavbarStyle}
                  system={systemSettings}
                  loading={systemLoading}
                  onSave={saveSystemField}
                />
              )}
              {current === "admin-tools" && <AdminToolsSection />}
              {current === "about" && <AboutSection />}
              {current === "danger" && (
                <DangerSection confirm={confirm} toast={toast} logout={logout} navigate={navigate} />
              )}
            </div>
          </div>
        ) : null}
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

// A second, optional sign-in identifier alongside email — set once here,
// changeable again only after a 30-day cooldown (see
// authController.setUsername / utils/username.js). Live-checks
// availability as the user types, debounced, against the same
// rate-limited endpoint the registration screen could also use.
function AccountUsername({ user, toast, onUsernameChanged }) {
  const { t } = useTranslation();
  const currentUsername = user?.username || "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentUsername);
  const [submitting, setSubmitting] = useState(false);
  // null | "checking" | "available" | "unavailable" | "same"
  const [checkState, setCheckState] = useState(null);
  const [checkMessage, setCheckMessage] = useState("");

  useEffect(() => {
    if (!editing) return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === currentUsername.toLowerCase()) {
      setCheckState(trimmed ? "same" : null);
      setCheckMessage("");
      return undefined;
    }

    setCheckState("checking");
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const { data } = await authAPI.checkUsernameAvailable(trimmed);
        if (cancelled) return;
        if (data?.available) {
          setCheckState("available");
          setCheckMessage("");
        } else {
          setCheckState("unavailable");
          setCheckMessage(data?.reason || t("settings.account.username.taken"));
        }
      } catch {
        if (!cancelled) setCheckState(null);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value, editing, currentUsername, t]);

  const startEditing = () => {
    setValue(currentUsername);
    setCheckState(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setValue(currentUsername);
    setCheckState(null);
    setEditing(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === currentUsername.toLowerCase()) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await authAPI.setUsername(trimmed);
      toast.success(data?.message || t("settings.account.username.updateSuccess"));
      onUsernameChanged?.(data?.username ?? trimmed.toLowerCase());
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || t("settings.account.username.updateError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">{t("settings.account.username.title")}</span>
          <span className="set-subrow__hint">
            {currentUsername
              ? t("settings.account.username.currentHint", { username: currentUsername })
              : t("settings.account.username.noneHint")}
          </span>
        </div>
        <button type="button" className="set-btn set-btn--ghost" onClick={startEditing}>
          {currentUsername ? t("settings.account.username.change") : t("settings.account.username.setOne")}
        </button>
      </div>
    );
  }

  const blockSubmit = submitting || checkState === "unavailable" || checkState === "checking";

  return (
    <form className="set-subrow set-subrow--column" onSubmit={handleSubmit}>
      <div>
        <span className="set-subrow__title">{t("settings.account.username.title")}</span>
        <span className="set-subrow__hint">{t("settings.account.username.hint")}</span>
      </div>
      <label className="set-field">
        <span className="set-field__label">{t("settings.account.username.label")}</span>
        <input
          type="text"
          value={value}
          disabled={submitting}
          placeholder={t("settings.account.username.placeholder")}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="username"
          maxLength={30}
        />
      </label>
      {checkState === "checking" && <p className="set-hint">{t("common.loading")}</p>}
      {checkState === "available" && (
        <p className="set-hint set-hint--ok">{t("settings.account.username.available")}</p>
      )}
      {checkState === "unavailable" && <p className="set-error">{checkMessage}</p>}
      <div className="set-actions">
        <button type="submit" className="set-btn set-btn--primary" disabled={blockSubmit}>
          {submitting ? t("common.loading") : t("common.save")}
        </button>
        <button type="button" className="set-btn set-btn--ghost" disabled={submitting} onClick={cancelEditing}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

// Google-only accounts (no local password yet) have exactly one way in —
// "Continue with Google". If the owner ever loses access to that Google
// account itself (its own 2FA challenge, no phone on hand, etc.), there is
// no recovery path. This card lets them add a password proactively, before
// that happens. Re-auth is a FRESH Google credential (not the long-lived
// session JWT) — see authController.setPassword for why.
function AccountSecurity({ user, toast, onPasswordAdded }) {
  const { t } = useTranslation();
  const isGoogleLinked = Boolean(user?.googleId);
  // `hasPassword` only exists once /auth/profile has hydrated the user
  // object (see AuthContext). Default to "has one" so an ordinary,
  // non-Google account never flashes this card while that's still loading.
  const hasPassword = user?.hasPassword !== false;
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (hasPassword) {
    return (
      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">{t("settings.account.security.passwordTitle")}</span>
          <span className="set-subrow__hint">{t("settings.account.security.passwordHint")}</span>
        </div>
        <Link to="/change-password" className="set-btn set-btn--ghost">
          {t("settings.account.security.changePassword")}
        </Link>
      </div>
    );
  }

  // Schema-wise this shouldn't happen (User.password is required unless
  // googleId is set) — but if it ever did, there's nothing useful to offer
  // here, so render nothing rather than a dead-end card.
  if (!isGoogleLinked) return null;

  const handleGoogleCredential = async (credential) => {
    if (newPassword.length < 8) {
      toast.error(t("settings.account.security.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.account.security.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await authAPI.setPassword(credential, newPassword);
      if (data?.token) localStorage.setItem("token", data.token);
      toast.success(data?.message || t("settings.account.security.addSuccess"));
      setNewPassword("");
      setConfirmPassword("");
      onPasswordAdded?.();
    } catch (err) {
      toast.error(err?.response?.data?.message || t("settings.account.security.addError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="set-subrow set-subrow--column">
      <div>
        <span className="set-subrow__title">{t("settings.account.security.addPasswordTitle")}</span>
        <span className="set-subrow__hint">{t("settings.account.security.addPasswordHint")}</span>
      </div>
      <label className="set-field">
        <span className="set-field__label">{t("settings.account.security.newPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          disabled={submitting}
          placeholder={t("settings.account.security.newPasswordPlaceholder")}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>
      <label className="set-field">
        <span className="set-field__label">{t("settings.account.security.confirmPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          disabled={submitting}
          placeholder={t("settings.account.security.confirmPasswordPlaceholder")}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>
      <GoogleSignInButton
        showDivider={false}
        fullWidth
        text="continue_with"
        onCredential={handleGoogleCredential}
        onError={() => toast.error(t("settings.account.security.googleLoadError"))}
      />
    </div>
  );
}

// Safe to show once the viewer already IS the account owner (this only
// ever renders inside Settings, behind a normal session) — masks enough
// that a glance at a shared screen doesn't hand the address to someone
// else, while still confirming "yes, that's the one I set".
const maskEmail = (email) => {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return email || "";
  const dotIndex = domain.lastIndexOf(".");
  const domainName = dotIndex > 0 ? domain.slice(0, dotIndex) : domain;
  const tld = dotIndex > 0 ? domain.slice(dotIndex) : "";
  const maskedLocal = `${local[0]}${"•".repeat(Math.min(4, Math.max(1, local.length - 1)))}`;
  const maskedDomain = `${domainName[0]}${"•".repeat(Math.min(3, Math.max(1, domainName.length - 1)))}${tld}`;
  return `${maskedLocal}@${maskedDomain}`;
};

// A second password-reset destination for when the primary inbox itself is
// unreachable (see ForgotPassword's "try my recovery email instead" and
// authController.requestRecoveryEmail). Setting/changing it re-authenticates
// with the current password, same gate as changing the sign-in email —
// Google-only accounts with no password yet are pointed at "Add a password"
// above instead of shown a form that can only ever fail.
function AccountRecoveryEmail({ user, toast }) {
  const { t } = useTranslation();
  const hasPassword = user?.hasPassword !== false;
  const verified = Boolean(user?.recoveryEmail && user?.recoveryEmailVerifiedAt);
  const pending = Boolean(user?.recoveryEmail && !user?.recoveryEmailVerifiedAt);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tracks the address Settings has already shown a "check your inbox"
  // notice for, so re-rendering after a save doesn't repeat it forever —
  // reset whenever the user starts editing again.
  const [justRequested, setJustRequested] = useState("");

  const startEditing = () => {
    setValue("");
    setCurrentPassword("");
    setJustRequested("");
    setEditing(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const { data } = await authAPI.requestRecoveryEmail(trimmed, currentPassword);
      toast.success(data?.message || t("settings.account.recoveryEmail.requestSuccess"));
      setJustRequested(trimmed);
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || t("settings.account.recoveryEmail.requestError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">{t("settings.account.recoveryEmail.title")}</span>
          <span className="set-subrow__hint">
            {justRequested
              ? t("settings.account.recoveryEmail.justRequestedHint", { email: justRequested })
              : verified
              ? t("settings.account.recoveryEmail.verifiedHint", { email: maskEmail(user.recoveryEmail) })
              : pending
              ? t("settings.account.recoveryEmail.pendingHint", { email: maskEmail(user.recoveryEmail) })
              : t("settings.account.recoveryEmail.noneHint")}
          </span>
        </div>
        <button type="button" className="set-btn set-btn--ghost" onClick={startEditing}>
          {verified || pending ? t("settings.account.recoveryEmail.change") : t("settings.account.recoveryEmail.add")}
        </button>
      </div>
    );
  }

  if (!hasPassword) {
    return (
      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">{t("settings.account.recoveryEmail.title")}</span>
          <span className="set-subrow__hint">{t("settings.account.recoveryEmail.needsPasswordHint")}</span>
        </div>
        <button type="button" className="set-btn set-btn--ghost" onClick={() => setEditing(false)}>
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <form className="set-subrow set-subrow--column" onSubmit={handleSubmit}>
      <div>
        <span className="set-subrow__title">{t("settings.account.recoveryEmail.title")}</span>
        <span className="set-subrow__hint">{t("settings.account.recoveryEmail.formHint")}</span>
      </div>
      <label className="set-field">
        <span className="set-field__label">{t("settings.account.recoveryEmail.emailLabel")}</span>
        <input
          type="email"
          value={value}
          disabled={submitting}
          placeholder={t("settings.account.recoveryEmail.emailPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label className="set-field">
        <span className="set-field__label">{t("settings.account.recoveryEmail.currentPasswordLabel")}</span>
        <input
          type="password"
          value={currentPassword}
          disabled={submitting}
          placeholder={t("settings.account.recoveryEmail.currentPasswordPlaceholder")}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <div className="set-actions">
        <button type="submit" className="set-btn set-btn--primary" disabled={submitting}>
          {submitting ? t("common.loading") : t("common.save")}
        </button>
        <button type="button" className="set-btn set-btn--ghost" disabled={submitting} onClick={() => setEditing(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

// 10 one-time codes for the one recovery path that needs neither a password
// nor a live Google session (see AccountRecovery.jsx + redeemBackupCode).
// The raw codes exist only in the single generate response — never fetched,
// stored, or shown again after this render.
function AccountBackupCodes({ user, toast, confirm }) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [codes, setCodes] = useState(null);

  const hasExisting = Boolean(user?.backupCodesGeneratedAt);

  const handleGenerate = async () => {
    if (hasExisting) {
      const ok = await confirm({
        title: t("settings.account.backupCodes.regenerateConfirmTitle"),
        message: t("settings.account.backupCodes.regenerateConfirmMessage"),
        tone: "danger",
        confirmLabel: t("settings.account.backupCodes.regenerateConfirmLabel"),
      });
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const { data } = await authAPI.generateBackupCodes();
      setCodes(data?.codes || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || t("settings.account.backupCodes.generateError"));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success(t("settings.account.backupCodes.copied"));
    } catch {
      toast.error(t("settings.account.backupCodes.copyError"));
    }
  };

  // Offline copy of the codes already on screen. No server call: generating
  // again would invalidate these and count against the hourly limit.
  const handleDownload = () => {
    try {
      const text = buildBackupCodesText(codes, {
        title: t("settings.account.backupCodes.file.title"),
        generatedLabel: t("settings.account.backupCodes.file.generated", { date: localDateStamp() }),
        notes: [
          t("settings.account.backupCodes.file.note1"),
          t("settings.account.backupCodes.file.note2"),
        ],
      });
      downloadTextFile(backupCodesFilename(), text);
      toast.success(t("settings.account.backupCodes.downloaded"));
    } catch {
      toast.error(t("settings.account.backupCodes.downloadError"));
    }
  };

  if (codes) {
    return (
      <div className="set-subrow set-subrow--column">
        <div>
          <span className="set-subrow__title">{t("settings.account.backupCodes.title")}</span>
          <span className="set-subrow__hint">{t("settings.account.backupCodes.savedWarning")}</span>
        </div>
        <div className="set-backupcodes-grid">
          {codes.map((code) => (
            <code key={code} className="set-backupcodes-grid__code">
              {code}
            </code>
          ))}
        </div>
        <div className="set-actions">
          <button type="button" className="set-btn set-btn--ghost" onClick={handleCopyAll}>
            {t("settings.account.backupCodes.copyAll")}
          </button>
          <button type="button" className="set-btn set-btn--ghost" onClick={handleDownload}>
            <FaDownload aria-hidden="true" /> {t("settings.account.backupCodes.download")}
          </button>
          <button type="button" className="set-btn set-btn--primary" onClick={() => setCodes(null)}>
            {t("settings.account.backupCodes.done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="set-subrow">
      <div>
        <span className="set-subrow__title">{t("settings.account.backupCodes.title")}</span>
        <span className="set-subrow__hint">
          {hasExisting
            ? t("settings.account.backupCodes.generatedHint", {
                date: new Date(user.backupCodesGeneratedAt).toLocaleDateString(),
              })
            : t("settings.account.backupCodes.noneHint")}
        </span>
      </div>
      <button type="button" className="set-btn set-btn--ghost" onClick={handleGenerate} disabled={generating}>
        {generating
          ? t("common.loading")
          : hasExisting
          ? t("settings.account.backupCodes.regenerate")
          : t("settings.account.backupCodes.generate")}
      </button>
    </div>
  );
}

function AccountIdOcr({ user }) {
  return <div className="set-subrow set-subrow--column"><IdOcrReview initialOcr={user?.governmentIdOcr} /></div>;
}

function AccountSection({ role, user, displayName, toast, confirm, onPasswordAdded, onUsernameChanged }) {
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
          {needsEmail(user) ? (
            <dd>
              {t("settings.account.emailNotSet")}{" "}
              <button type="button" className="set-btn set-btn--ghost" onClick={() => openEmailPrompt()}>
                {t("settings.account.addEmail")}
              </button>
              <span className="set-subrow__hint">{t("settings.account.emailUnverifiedHint")}</span>
            </dd>
          ) : (
            <dd>{user?.email || "—"}</dd>
          )}
        </div>
        <div>
          <dt>{t("settings.account.phone")}</dt>
          <dd>{user?.phone ? formatPhoneDisplay(user.phone) : "—"}</dd>
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

      <AccountUsername user={user} toast={toast} onUsernameChanged={onUsernameChanged} />

      <AccountSecurity user={user} toast={toast} onPasswordAdded={onPasswordAdded} />

      <AccountRecoveryEmail user={user} toast={toast} />

      <AccountBackupCodes user={user} toast={toast} confirm={confirm} />
      {role === "jobseeker" && <AccountIdOcr user={user} />}

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

  const load = useCallback(async () => {
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
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

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

function NotificationsSection({ role, prefs, emailPrefs, loading, onToggle, onEmailToggle }) {
  const { t } = useTranslation();
  // Per-category email switches are only meaningful while the master is on
  // (see queueNotificationEmail's gating order) — dimmed, not hidden, so
  // turning the master back on restores whatever was set per category.
  const emailDisabled = emailPrefs.emailAll === false;
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.notifications.title")}
        subtitle={t("settings.notifications.subtitle")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}

      <Toggle
        id="n-email-all"
        checked={emailPrefs.emailAll}
        disabled={loading}
        onChange={(v) => onEmailToggle("emailAll", v)}
        label={t("settings.notifications.emailAll")}
        hint={t("settings.notifications.emailAllHint")}
      />

      <div className="set-toggle-group">
        {role === "jobseeker" && (
          <>
            <DualToggle
              id="n-msg"
              inAppChecked={prefs.notifyMessages}
              emailChecked={emailPrefs.notifyMessages}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyMessages", v)}
              onEmailChange={(v) => onEmailToggle("notifyMessages", v)}
              label={t("settings.notifications.newMessages")}
              hint={t("settings.notifications.newMessagesHint")}
            />
            <DualToggle
              id="n-match"
              inAppChecked={prefs.notifyJobMatch}
              emailChecked={emailPrefs.notifyJobMatch}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyJobMatch", v)}
              onEmailChange={(v) => onEmailToggle("notifyJobMatch", v)}
              label={t("settings.notifications.jobMatches")}
              hint={t("settings.notifications.jobMatchesHint")}
            />
            <DualToggle
              id="n-appupd"
              inAppChecked={prefs.notifyApplicationUpdate}
              emailChecked={emailPrefs.notifyApplicationUpdate}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyApplicationUpdate", v)}
              onEmailChange={(v) => onEmailToggle("notifyApplicationUpdate", v)}
              label={t("settings.notifications.applicationUpdates")}
              hint={t("settings.notifications.applicationUpdatesHint")}
            />
          </>
        )}
        {role === "employer" && (
          <>
            <DualToggle
              id="n-applicant"
              inAppChecked={prefs.notifyNewApplicant}
              emailChecked={emailPrefs.notifyNewApplicant}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyNewApplicant", v)}
              onEmailChange={(v) => onEmailToggle("notifyNewApplicant", v)}
              label={t("settings.notifications.newApplicants")}
              hint={t("settings.notifications.newApplicantsHint")}
            />
            <DualToggle
              id="n-expiring"
              inAppChecked={prefs.notifyJobExpiring}
              emailChecked={emailPrefs.notifyJobExpiring}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyJobExpiring", v)}
              onEmailChange={(v) => onEmailToggle("notifyJobExpiring", v)}
              label={t("settings.notifications.vacancyExpiring")}
              hint={t("settings.notifications.vacancyExpiringHint")}
            />
          </>
        )}
        {role === "admin" && (
          <>
            <DualToggle
              id="n-verif"
              inAppChecked={prefs.notifyVerificationRequest}
              emailChecked={emailPrefs.notifyVerificationRequest}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyVerificationRequest", v)}
              onEmailChange={(v) => onEmailToggle("notifyVerificationRequest", v)}
              label={t("settings.notifications.verificationRequests")}
              hint={t("settings.notifications.verificationRequestsHint")}
            />
            <DualToggle
              id="n-report"
              inAppChecked={prefs.notifyUserReport}
              emailChecked={emailPrefs.notifyUserReport}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyUserReport", v)}
              onEmailChange={(v) => onEmailToggle("notifyUserReport", v)}
              label={t("settings.notifications.userReports")}
              hint={t("settings.notifications.userReportsHint")}
            />
            <DualToggle
              id="n-spes"
              inAppChecked={prefs.notifySpesSubmission}
              emailChecked={emailPrefs.notifySpesSubmission}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifySpesSubmission", v)}
              onEmailChange={(v) => onEmailToggle("notifySpesSubmission", v)}
              label={t("settings.notifications.spesSubmissions")}
              hint={t("settings.notifications.spesSubmissionsHint")}
            />
            <DualToggle
              id="n-account-recovery"
              inAppChecked={prefs.notifyAccountRecovery}
              emailChecked={emailPrefs.notifyAccountRecovery}
              disabled={loading}
              emailDisabled={emailDisabled}
              onInAppChange={(v) => onToggle("notifyAccountRecovery", v)}
              onEmailChange={(v) => onEmailToggle("notifyAccountRecovery", v)}
              label={t("staffRecovery.queue")}
              hint={t("staffRecovery.notificationHint")}
            />
          </>
        )}
      </div>
    </section>
  );
}

function PrivacySection({ role, privacy, loading, onChange }) {
  const { t } = useTranslation();
  // Profile visibility and "who can message me" are jobseeker-only settings;
  // every role that can use messaging gets the active-status switch.
  const isJobseeker = role === "jobseeker";
  return (
    <section className="set-card">
      <SectionHead
        title={t("settings.privacy.title")}
        subtitle={isJobseeker ? t("settings.privacy.subtitle") : t("settings.privacy.subtitleActiveOnly")}
      />

      {loading && <p className="set-hint">{t("common.loading")}</p>}

      <Toggle
        id="privacy-show-active-status"
        checked={privacy.showActiveStatus !== false}
        disabled={loading}
        onChange={(value) => onChange("showActiveStatus", value)}
        label={t("settings.privacy.showActiveStatus")}
        hint={t("settings.privacy.showActiveStatusHint")}
      />

      {isJobseeker && (<>
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
      </>)}
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

function SystemSection({ role, navbarStyle, onNavbarStyleChange, system, loading, onSave }) {
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

  const [graceDraft, setGraceDraft] = useState(String(system.deletedAccountGraceDays ?? 30));
  const [syncedGrace, setSyncedGrace] = useState(system.deletedAccountGraceDays);
  if (system.deletedAccountGraceDays !== syncedGrace) {
    setSyncedGrace(system.deletedAccountGraceDays);
    setGraceDraft(String(system.deletedAccountGraceDays ?? 30));
  }
  const commitGrace = () => {
    const current = system.deletedAccountGraceDays ?? 30;
    const clamped = Math.min(365, Math.max(7, Math.round(Number(graceDraft)) || current));
    setGraceDraft(String(clamped));
    if (clamped !== current) onSave({ deletedAccountGraceDays: clamped });
  };

  // Staff activation invite: link lifetime (hours) and the wait between resends (seconds).
  const [inviteHoursDraft, setInviteHoursDraft] = useState(String(system.staffInviteExpiryHours ?? 48));
  const [syncedInviteHours, setSyncedInviteHours] = useState(system.staffInviteExpiryHours);
  if (system.staffInviteExpiryHours !== syncedInviteHours) {
    setSyncedInviteHours(system.staffInviteExpiryHours);
    setInviteHoursDraft(String(system.staffInviteExpiryHours ?? 48));
  }
  const commitInviteHours = () => {
    const current = system.staffInviteExpiryHours ?? 48;
    const clamped = Math.min(168, Math.max(1, Math.round(Number(inviteHoursDraft)) || current));
    setInviteHoursDraft(String(clamped));
    if (clamped !== current) onSave({ staffInviteExpiryHours: clamped });
  };
  const [inviteCooldownDraft, setInviteCooldownDraft] = useState(String(system.staffInviteResendCooldownSeconds ?? 60));
  const [syncedInviteCooldown, setSyncedInviteCooldown] = useState(system.staffInviteResendCooldownSeconds);
  if (system.staffInviteResendCooldownSeconds !== syncedInviteCooldown) {
    setSyncedInviteCooldown(system.staffInviteResendCooldownSeconds);
    setInviteCooldownDraft(String(system.staffInviteResendCooldownSeconds ?? 60));
  }
  const commitInviteCooldown = () => {
    const current = system.staffInviteResendCooldownSeconds ?? 60;
    const clamped = Math.min(3600, Math.max(30, Math.round(Number(inviteCooldownDraft)) || current));
    setInviteCooldownDraft(String(clamped));
    if (clamped !== current) onSave({ staffInviteResendCooldownSeconds: clamped });
  };

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
        title={t("settings.system.navbarTitle")}
        subtitle={t("settings.system.navbarSubtitle")}
      />

      <div className="set-navstyle-options" role="radiogroup" aria-label={t("settings.system.navbarTitle")}>
        <button
          type="button"
          role="radio"
          aria-checked={navbarStyle === "full"}
          className={`set-navstyle-option${navbarStyle === "full" ? " is-selected" : ""}`}
          onClick={() => onNavbarStyleChange("full")}
        >
          <span className="set-navstyle-option__radio" aria-hidden="true" />
          <span>
            <span className="set-navstyle-option__title">{t("settings.system.navbarFullTitle")}</span>
            <span className="set-navstyle-option__desc">{t("settings.system.navbarFullDesc")}</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={navbarStyle === "icons"}
          className={`set-navstyle-option${navbarStyle === "icons" ? " is-selected" : ""}`}
          onClick={() => onNavbarStyleChange("icons")}
        >
          <span className="set-navstyle-option__radio" aria-hidden="true" />
          <span>
            <span className="set-navstyle-option__title">{t("settings.system.navbarIconsTitle")}</span>
            <span className="set-navstyle-option__desc">{t("settings.system.navbarIconsDesc")}</span>
          </span>
        </button>
      </div>

      {(role === "jobseeker" || role === "employer") && (
        <>
          <hr className="set-divider" />
          <SectionHead title={t("chatbot.pref.heading")} />
          <PesoHelpFloatingToggle />
        </>
      )}

      {role === "superadmin" && (
        <>
          <hr className="set-divider" />
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

          <label className="set-field">
            <span className="set-field__label">{t("settings.system.deletedGraceLabel")}</span>
            <div className="set-field__inline">
              <input
                type="number"
                min="7"
                max="365"
                value={graceDraft}
                disabled={loading}
                onChange={(e) => setGraceDraft(e.target.value)}
                onBlur={commitGrace}
              />
              <span>{t("settings.system.deletedGraceSuffix")}</span>
            </div>
          </label>

          <label className="set-field">
            <span className="set-field__label">{t("settings.system.inviteExpiryLabel")}</span>
            <div className="set-field__inline">
              <input
                type="number"
                min="1"
                max="168"
                value={inviteHoursDraft}
                disabled={loading}
                onChange={(e) => setInviteHoursDraft(e.target.value)}
                onBlur={commitInviteHours}
              />
              <span>{t("settings.system.inviteExpirySuffix")}</span>
            </div>
          </label>

          <label className="set-field">
            <span className="set-field__label">{t("settings.system.inviteCooldownLabel")}</span>
            <div className="set-field__inline">
              <input
                type="number"
                min="30"
                max="3600"
                value={inviteCooldownDraft}
                disabled={loading}
                onChange={(e) => setInviteCooldownDraft(e.target.value)}
                onBlur={commitInviteCooldown}
              />
              <span>{t("settings.system.inviteCooldownSuffix")}</span>
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
        </>
      )}
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
