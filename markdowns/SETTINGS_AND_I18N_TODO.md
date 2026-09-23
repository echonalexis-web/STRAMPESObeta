# Settings & Language Switch — Remaining Work

Status snapshot as of this session. No code was changed while writing this document.

## 1. Language switch (i18n) rollout

**Done:** `react-i18next` is installed and configured (`client/src/i18n/`), with English and Filipino translation files. The language dropdown in **Settings → Language & Region** calls `i18n.changeLanguage()` for real and persists the choice. Two surfaces are fully translated and verified to switch correctly:

- The Navbar (both the logged-in sidebar and the logged-out public nav)
- The Settings page itself, including every section (Account, Language, Templates, Notifications, Privacy, Access, System, Admin Tools, About, Danger)

**Not done — every other page still renders hardcoded English.** Switching the dropdown to Filipino will not change any of these until they're each converted the same way (strings extracted into translation keys):

| Area | Pages |
|---|---|
| Auth | Login, Register, EmployeeRegister, ForgotPassword, ResetPassword, VerifyEmail, ChangePassword |
| Public | Home, About, NewsFeed, NewsFeedDetail |
| Job seeker | Dashboard, YourApplications, JobBoard, JobDetail, Profile, ProfilePage, EditProfile |
| Employer | EmployerDashboard, PostJob, and related components |
| Onboarding | Onboarding, JobSeekerOnboarding, EmployerOnboarding |
| Admin | AdminDashboard, UserManagement, EmployerVerification, JobMonitoring, AuditTrail, Reports, NewsFeedManagement, CreateAnnouncement, ModerationQueues, SpesApplications, UserModeration, UserProfileView, ProvincialAnalyticsOverview |
| Superadmin | SuperadminConsole |
| Communication | Messages, Notifications, MySpesApplications |
| Shared components | Modals, cards, forms (VacancyCard, EmployerModal, InterviewScheduleModal, RankedApplicantsTable, etc.) |

That's roughly 65 remaining files.

## 2. Settings page — unfinished features (aside from language)

The Settings page (`client/src/pages/Settings.jsx`) has several sections marked with a **"Not yet available"** badge/banner (via the `NotYetAvailable` component). These are front-end-only previews: the controls render and save to the browser's `localStorage` (via `usePersistentState`) so the UI feels real, but **nothing is sent to the server, and no backend route or database field exists for any of them.**

### Notifications section
- Toggles: new messages, job matches, application updates (job seeker); new applicants, vacancy expiring (employer); verification requests, user reports, SPES submissions (admin).
- **Needed for real:** a notification-preferences schema on the `User` model, an API route to read/write it, and every place the app currently sends an email/notification would need to check the recipient's preference before sending.

### Privacy section
- "Profile visibility" (public / employers only / hidden) and "Who can message me" (anyone / employers only).
- **Needed for real:** schema fields on `User`, an API route to persist them, and enforcement at read time — profile-view endpoints would need to respect visibility, and the messaging controller would need to check the setting before allowing a new conversation to start.

### System Preferences section (superadmin only)
- Auto-close a vacancy after N days of inactivity, suspension appeal window (days), new-account registration mode (open / invite-only / closed), and a toggle requiring employer verification before posting.
- **Needed for real:** a portal-wide settings document (singleton collection or config table), an admin-only API route to read/write it, and each rule would need to be enforced where it applies — a scheduled job for auto-closing vacancies, the appeal-window check in the appeals controller, a registration-mode gate in the register endpoint, and a verification check in the job-posting endpoint. None of these enforcement points currently read from any such config.

### Account Deactivation section
- "Deactivate my account" button currently only shows a toast saying it isn't available — it changes nothing.
- Note: the backend does have an admin-initiated `deactivateUser` (a superadmin suspending another user's account, in `adminController.js`). This is a **different, unrelated feature** from self-service deactivation. Self-service would need its own route (a user deactivating their own account), sign-out handling, and a defined path for the PESO office to reactivate it.

### Templates section — "Job Posting Templates" (partially built)
- The existing "Qualification Templates" list (save/delete reusable qualification sets) is fully functional today, backed by `employerAPI.getQualificationTemplates()` / `deleteQualificationTemplate()`.
- The adjacent "Job Posting Templates" row — saving an entire vacancy (title, pay, logistics, requirements) as one reusable template — is marked "Coming soon" and has no UI or backend behind it yet.

### Fully working, for contrast
- **Account** section (name/email/phone/company/role display, links to Edit Profile) — real data, no stub.
- **Your Access** section (admin/superadmin module list) — informational only, no persistence needed.
- **Admin Tools** section (links to Superadmin Console, User Management, Audit Trail) — just navigation, no stub.
- **About STRAM PESO** section — static content, no stub.
