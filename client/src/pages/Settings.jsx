import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { employerAPI } from "../services/api";
import { usePersistentState } from "../hooks/usePersistentState";
import { useToast, useConfirm } from "../components/feedback/context";
import NotYetAvailable from "../components/NotYetAvailable";
import "../styles/settings.css";

const normalizeRole = (role) =>
  role === "employee" || role === "jobseeker" ? "resident" : role;

const ROLE_LABEL = {
  resident: "Job Seeker",
  employer: "Employer",
  admin: "Administrator",
  superadmin: "System Superadmin",
};

// Front-end-only defaults. These persist to localStorage so the controls feel
// real, but nothing here is sent to the server yet.
const DRAFT_DEFAULTS = {
  language: "en",
  notifyMessages: true,
  notifyJobMatch: true,
  notifyApplicationUpdate: true,
  notifyNewApplicant: true,
  notifyJobExpiring: true,
  notifyVerificationRequest: true,
  notifyUserReport: true,
  notifySpesSubmission: true,
  profileVisibility: "public",
  allowMessagesFrom: "anyone",
  sysAutoCloseDays: 30,
  sysRequireVerification: true,
  sysAppealWindowDays: 14,
  sysRegistrationMode: "open",
};

const SECTIONS_BY_ROLE = {
  resident: ["account", "language", "notifications", "privacy", "about", "danger"],
  employer: ["account", "language", "templates", "notifications", "about", "danger"],
  admin: ["account", "notifications", "access", "about"],
  superadmin: ["account", "system", "admin-tools", "about"],
};

const SECTION_META = {
  account: { label: "Account", icon: <FaUserCog /> },
  language: { label: "Language & Region", icon: <FaLanguage /> },
  templates: { label: "Templates", icon: <FaLayerGroup /> },
  notifications: { label: "Notifications", icon: <FaBell /> },
  privacy: { label: "Privacy", icon: <FaUserShield /> },
  access: { label: "Your Access", icon: <FaClipboardList /> },
  system: { label: "System Preferences", icon: <FaSlidersH /> },
  "admin-tools": { label: "Admin Tools", icon: <FaClipboardList /> },
  about: { label: "About STRAM PESO", icon: <FaInfoCircle /> },
  danger: { label: "Account Deactivation", icon: <FaExclamationTriangle /> },
};

const ADMIN_MODULES = [
  "Admin Dashboard & Reports",
  "Employer Verification queue",
  "Job Monitoring",
  "News Feed & Announcements",
  "SPES Applications",
];

const SUPERADMIN_MODULES = [
  "Superadmin Console (admin account provisioning)",
  "User Management directory",
  "Reports & Appeals / moderation",
  "Employer Verification queue",
  "Job Monitoring",
  "Audit Trail",
];

function Toggle({ id, checked, onChange, label, hint }) {
  return (
    <label className="set-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
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
  const { user } = useContext(AuthContext);
  const toast = useToast();
  const confirm = useConfirm();

  const role = normalizeRole(user?.role) || "resident";
  const sections = SECTIONS_BY_ROLE[role] || SECTIONS_BY_ROLE.resident;

  const [activeSection, setActiveSection] = usePersistentState(
    "settingsActiveSection",
    { value: sections[0] }
  );
  const active = sections.includes(activeSection?.value)
    ? activeSection.value
    : sections[0];

  const [draft, setDraft] = usePersistentState("settingsDraft", DRAFT_DEFAULTS);
  const d = { ...DRAFT_DEFAULTS, ...(draft || {}) };
  const setField = (key, val) => setDraft((prev) => ({ ...DRAFT_DEFAULTS, ...prev, [key]: val }));

  const go = (value) => setActiveSection({ value });

  const displayName =
    user?.name ||
    [user?.firstName, user?.surname].filter(Boolean).join(" ") ||
    "Your account";

  return (
    <div className="set">
      <div className="set__main">
        <header className="set__pagehead">
          <span className="set__pagehead-icon">
            <FaUserCog />
          </span>
          <div>
            <h1>Settings</h1>
            <p>Manage your account, preferences, and how STRAM PESO works for you.</p>
          </div>
        </header>

        <div className="set__layout">
          <nav className="set__rail" aria-label="Settings sections">
            {sections.map((key) => (
              <button
                key={key}
                type="button"
                className={`set__rail-item ${active === key ? "is-active" : ""}`}
                onClick={() => go(key)}
              >
                <span className="set__rail-icon">{SECTION_META[key].icon}</span>
                <span>{SECTION_META[key].label}</span>
                <FaChevronRight className="set__rail-caret" aria-hidden="true" />
              </button>
            ))}
          </nav>

          <div className="set__panel">
            {active === "account" && (
              <AccountSection role={role} user={user} displayName={displayName} />
            )}
            {active === "language" && (
              <LanguageSection value={d.language} onChange={(v) => setField("language", v)} />
            )}
            {active === "templates" && <TemplatesSection toast={toast} confirm={confirm} />}
            {active === "notifications" && (
              <NotificationsSection role={role} d={d} setField={setField} />
            )}
            {active === "privacy" && (
              <PrivacySection d={d} setField={setField} />
            )}
            {active === "access" && <AccessSection role={role} />}
            {active === "system" && <SystemSection d={d} setField={setField} />}
            {active === "admin-tools" && <AdminToolsSection />}
            {active === "about" && <AboutSection />}
            {active === "danger" && <DangerSection confirm={confirm} toast={toast} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────── */

function SectionHead({ title, subtitle, badge }) {
  return (
    <div className="set-card__head">
      <div>
        <h2 className="set-card__title">
          {title}
          {badge}
        </h2>
        {subtitle && <p className="set-card__subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}

function AccountSection({ role, user, displayName }) {
  return (
    <section className="set-card">
      <SectionHead
        title="Account"
        subtitle="Your sign-in details and profile information."
      />
      <dl className="set-kv">
        <div>
          <dt>Name</dt>
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user?.email || "—"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{user?.phone || "—"}</dd>
        </div>
        {role === "employer" && (
          <div>
            <dt>Company</dt>
            <dd>{user?.companyName || "—"}</dd>
          </div>
        )}
        <div>
          <dt>Role</dt>
          <dd>
            <span className="set-rolebadge">{ROLE_LABEL[role] || role}</span>
          </dd>
        </div>
      </dl>
      <div className="set-actions">
        <Link to="/profile/edit" className="set-btn set-btn--primary">
          Edit full profile <FaArrowRight aria-hidden="true" />
        </Link>
        <Link to="/profile" className="set-btn set-btn--ghost">
          View profile
        </Link>
      </div>
      <p className="set-hint">
        Email, password, and every profile field are managed on the Edit Profile
        page.
      </p>
    </section>
  );
}

function LanguageSection({ value, onChange }) {
  return (
    <section className="set-card">
      <SectionHead
        title="Language & Region"
        subtitle="Choose the language STRAM PESO is shown in."
        badge={<NotYetAvailable />}
      />
      <NotYetAvailable variant="banner" />
      <label className="set-field">
        <span className="set-field__label">Display language</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </select>
      </label>
      <p className="set-hint">
        Full translation of the portal is planned. For now this only remembers
        your choice on this device.
      </p>
    </section>
  );
}

function TemplatesSection({ toast, confirm }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await employerAPI.getQualificationTemplates();
      const all = Array.isArray(res.data?.templates) ? res.data.templates : [];
      setTemplates(all.filter((t) => t.source === "custom"));
    } catch {
      setError("Couldn't load your templates. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (tpl) => {
    const ok = await confirm({
      title: `Delete "${tpl.name}"?`,
      message: "This removes the saved template. Jobs already posted with it are not affected.",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await employerAPI.deleteQualificationTemplate(tpl.id);
      setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
      toast.success("Template deleted.");
    } catch {
      toast.error("Couldn't delete that template.");
    }
  };

  return (
    <section className="set-card">
      <SectionHead
        title="Qualification Templates"
        subtitle="Reusable qualification sets you've saved from the job posting form."
      />

      {loading && <p className="set-hint">Loading templates…</p>}
      {error && !loading && <p className="set-error">{error}</p>}

      {!loading && !error && templates.length === 0 && (
        <p className="set-empty">
          No saved templates yet. When posting a vacancy, use{" "}
          <strong>Save as template</strong> in the Qualifications step and it will
          appear here.
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
                  {tpl.items.length} item{tpl.items.length === 1 ? "" : "s"}
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
                <FaTrashAlt aria-hidden="true" /> Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="set-hint">
        Create and edit templates from the <Link to="/post-job">Post Vacancy</Link>{" "}
        form — the Qualifications step has the full editor.
      </p>

      <div className="set-subrow">
        <div>
          <span className="set-subrow__title">Job Posting Templates</span>
          <span className="set-subrow__hint">
            Save an entire vacancy — title, pay, logistics, requirements — as one
            reusable template.
          </span>
        </div>
        <span className="set-comingsoon">Coming soon</span>
      </div>
    </section>
  );
}

function NotificationsSection({ role, d, setField }) {
  return (
    <section className="set-card">
      <SectionHead
        title="Notifications"
        subtitle="Choose which emails STRAM PESO sends you."
        badge={<NotYetAvailable />}
      />
      <NotYetAvailable variant="banner" />

      <div className="set-toggle-group">
        {role === "resident" && (
          <>
            <Toggle
              id="n-msg"
              checked={d.notifyMessages}
              onChange={(v) => setField("notifyMessages", v)}
              label="New messages"
              hint="When an employer or the PESO office messages you."
            />
            <Toggle
              id="n-match"
              checked={d.notifyJobMatch}
              onChange={(v) => setField("notifyJobMatch", v)}
              label="Job matches"
              hint="New vacancies that fit your preferred occupations and location."
            />
            <Toggle
              id="n-appupd"
              checked={d.notifyApplicationUpdate}
              onChange={(v) => setField("notifyApplicationUpdate", v)}
              label="Application updates"
              hint="When the status of one of your applications changes."
            />
          </>
        )}
        {role === "employer" && (
          <>
            <Toggle
              id="n-applicant"
              checked={d.notifyNewApplicant}
              onChange={(v) => setField("notifyNewApplicant", v)}
              label="New applicants"
              hint="When someone applies to one of your vacancies."
            />
            <Toggle
              id="n-expiring"
              checked={d.notifyJobExpiring}
              onChange={(v) => setField("notifyJobExpiring", v)}
              label="Vacancy expiring soon"
              hint="A reminder before a posting auto-closes."
            />
          </>
        )}
        {role === "admin" && (
          <>
            <Toggle
              id="n-verif"
              checked={d.notifyVerificationRequest}
              onChange={(v) => setField("notifyVerificationRequest", v)}
              label="Employer verification requests"
              hint="When a new employer submits documents for review."
            />
            <Toggle
              id="n-report"
              checked={d.notifyUserReport}
              onChange={(v) => setField("notifyUserReport", v)}
              label="User reports"
              hint="When a user or a piece of content is reported."
            />
            <Toggle
              id="n-spes"
              checked={d.notifySpesSubmission}
              onChange={(v) => setField("notifySpesSubmission", v)}
              label="SPES submissions"
              hint="When a new SPES application comes in."
            />
          </>
        )}
      </div>
    </section>
  );
}

function PrivacySection({ d, setField }) {
  return (
    <section className="set-card">
      <SectionHead
        title="Privacy"
        subtitle="Control who can see your profile and message you."
        badge={<NotYetAvailable />}
      />
      <NotYetAvailable variant="banner" />

      <label className="set-field">
        <span className="set-field__label">Profile visibility</span>
        <select
          value={d.profileVisibility}
          onChange={(e) => setField("profileVisibility", e.target.value)}
        >
          <option value="public">Public — anyone signed in can view</option>
          <option value="employers">Employers only</option>
          <option value="hidden">Hidden — only me and the PESO office</option>
        </select>
      </label>

      <label className="set-field">
        <span className="set-field__label">Who can message me</span>
        <select
          value={d.allowMessagesFrom}
          onChange={(e) => setField("allowMessagesFrom", e.target.value)}
        >
          <option value="anyone">Anyone signed in</option>
          <option value="employers">Employers only</option>
        </select>
      </label>
    </section>
  );
}

function AccessSection({ role }) {
  const modules = role === "superadmin" ? SUPERADMIN_MODULES : ADMIN_MODULES;
  return (
    <section className="set-card">
      <SectionHead
        title="Your Access"
        subtitle="The parts of STRAM PESO your role can reach."
      />
      <ul className="set-list">
        {modules.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="set-hint">
        Access is set by your role. To change what an administrator can do, a
        superadmin manages it from the Superadmin Console.
      </p>
    </section>
  );
}

function SystemSection({ d, setField }) {
  return (
    <section className="set-card">
      <SectionHead
        title="System Preferences"
        subtitle="Portal-wide rules. Changing these affects every user."
        badge={<NotYetAvailable />}
      />
      <NotYetAvailable variant="banner" />

      <label className="set-field">
        <span className="set-field__label">Auto-close a vacancy after</span>
        <div className="set-field__inline">
          <input
            type="number"
            min="1"
            max="365"
            value={d.sysAutoCloseDays}
            onChange={(e) => setField("sysAutoCloseDays", e.target.value)}
          />
          <span>days with no activity</span>
        </div>
      </label>

      <label className="set-field">
        <span className="set-field__label">Appeal window</span>
        <div className="set-field__inline">
          <input
            type="number"
            min="1"
            max="90"
            value={d.sysAppealWindowDays}
            onChange={(e) => setField("sysAppealWindowDays", e.target.value)}
          />
          <span>days to appeal a suspension</span>
        </div>
      </label>

      <label className="set-field">
        <span className="set-field__label">New account registration</span>
        <select
          value={d.sysRegistrationMode}
          onChange={(e) => setField("sysRegistrationMode", e.target.value)}
        >
          <option value="open">Open — anyone can register</option>
          <option value="invite">Invite only</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      <div className="set-toggle-group">
        <Toggle
          id="s-verif"
          checked={d.sysRequireVerification}
          onChange={(v) => setField("sysRequireVerification", v)}
          label="Require employer verification before posting"
          hint="Employers must be verified by the PESO office before a vacancy goes live."
        />
      </div>
    </section>
  );
}

function AdminToolsSection() {
  return (
    <section className="set-card">
      <SectionHead
        title="Admin Tools"
        subtitle="Jump to the system management areas."
      />
      <div className="set-linklist">
        <Link to="/superadmin" className="set-linkrow">
          <span>
            <strong>Superadmin Console</strong>
            <small>Provision, disable, and reset administrator accounts.</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
        <Link to="/admin/users" className="set-linkrow">
          <span>
            <strong>User Management</strong>
            <small>The full directory of residents and employers.</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
        <Link to="/admin/audit-logs" className="set-linkrow">
          <span>
            <strong>Audit Trail</strong>
            <small>A record of sensitive actions across the system.</small>
          </span>
          <FaChevronRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="set-card">
      <SectionHead
        title="About STRAM PESO"
        subtitle="A province-wide employment portal for Marinduque."
      />
      <p className="set-prose">
        STRAM PESO connects jobseekers, employers, and the six municipalities of
        Marinduque, built on the province's Labor Market Data and the work of the
        Public Employment Service Office. It was designed and built as a
        4th-year capstone project by students of Marinduque State University —
        College of Information and Computing Sciences.
      </p>
      <div className="set-actions">
        <Link to="/about" className="set-btn set-btn--primary">
          View the full About page <FaArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function DangerSection({ confirm, toast }) {
  const handleDeactivate = async () => {
    const ok = await confirm({
      title: "Deactivate your account?",
      message:
        "Your profile will be hidden and you'll be signed out. You can ask the PESO office to restore it later.",
      tone: "danger",
      confirmLabel: "Deactivate",
    });
    if (!ok) return;
    toast.info("Account deactivation isn't available yet — nothing was changed.");
  };

  return (
    <section className="set-card set-card--danger">
      <SectionHead
        title="Account Deactivation"
        subtitle="Temporarily remove your account from STRAM PESO."
        badge={<NotYetAvailable />}
      />
      <NotYetAvailable
        variant="banner"
        note="Self-service deactivation is being built. The button below is a preview and won't change your account yet."
      />
      <p className="set-prose">
        Deactivating hides your profile and listings and signs you out. This is
        reversible — contact the PESO office to reactivate.
      </p>
      <div className="set-actions">
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={handleDeactivate}
        >
          Deactivate my account
        </button>
      </div>
    </section>
  );
}
