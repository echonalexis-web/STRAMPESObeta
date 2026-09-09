# Superadmin tier & admin account provisioning

This describes the two-tier staff model added to STRAM PESO and how you, as the
superadmin, create and manage LMDPESO admin accounts.

## The role model

| Role | Who | What they can do |
| --- | --- | --- |
| `resident` | Job seekers / SPES applicants | The public job-seeker app |
| `employer` | Companies posting jobs | The employer app |
| `admin` | **LMDPESO / PESO office staff** | Everything under `/admin`: user management, moderation queues, employer verification, job monitoring, news & announcements, SPES, notifications, audit logs |
| `superadmin` | **You (the maintainer)** | The technical surface only — see next section |

## Superadmin scope

The superadmin is a narrow technical role, **not** a super-powered admin. Its
sidebar (the shared app sidebar, same as every logged-in role) contains only:

| Item | Route | Notes |
| --- | --- | --- |
| Superadmin Console | `/superadmin` | Provision / disable / reset admin accounts |
| Admin Dashboard | `/admin`, `/admin/reports` | **Read-only** analytics, for oversight |
| User Management | `/admin/users`, `/admin/users/moderation` | Full user management + reports & appeals |
| Job Monitoring | `/admin/job-monitoring` | Stripped: no KPI cards, no charts, no "post a listing" — plus a permanent policy-takedown action |
| Audit Trail | `/admin/audit-logs` | |
| My Profile | `/profile` | Minimal (email, phone, role, status) — same layout as an admin profile |
| Messages | `/messages` | **Admin-only** — the superadmin can only converse with `admin` users; residents/employers can't reach it and vice-versa (enforced in `messageController`) |

Removed for the superadmin: News / Announcements management, SPES, and the
**Notifications** feed. Those routes bounce the superadmin to `/` if typed
directly (`requiredRole="admin"` in `App.jsx`; the superadmin is whitelisted
per-route with `["admin", "superadmin"]` only on the technical pages).

### Permanent job takedown (superadmin only)

PESO admins can only **close / reject** a vacancy. Permanently deleting one —
removing the job and every application to it — is a superadmin action, done from
Job Monitoring: open a job → **Permanently delete** → enter a reason. The
employer is notified it was removed for a policy violation, and the event is
logged as `superadmin.job.policy_takedown` in the audit trail. The old
`DELETE /admin/jobs/:id` endpoint was removed.

Key rules now enforced in code:

- **Admins can no longer create admins.** The "change role" action in User
  Management only moves accounts between `resident` and `employer`. Trying to set
  `admin` or `superadmin` there is rejected.
- **Admins cannot see, edit, suspend, or delete** `superadmin` accounts. Superadmin
  accounts are filtered out of the user list, the analytics counts, and the
  per-user views.
- **`superadmin` is never assignable through the app.** The only way to create one
  is the seed script below (or a direct database edit).
- Every action in the superadmin console is written to the **audit log**
  (`superadmin.admin.created`, `superadmin.admin.disabled`, `superadmin.admin.enabled`,
  `superadmin.admin.password_reset`).

## One-time setup: create your superadmin account

The superadmin account bootstraps from a script because nothing in the app can
create it. This is also your recovery path if you ever lose superadmin access.

From the `server/` directory:

**macOS / Linux**

```bash
SEED_SUPERADMIN_EMAIL="you@example.com" \
SEED_SUPERADMIN_PASSWORD="a-long-strong-passphrase" \
SEED_SUPERADMIN_NAME="Your Name" \
npm run seed:superadmin
```

**Windows PowerShell**

```powershell
$env:SEED_SUPERADMIN_EMAIL="you@example.com"
$env:SEED_SUPERADMIN_PASSWORD="a-long-strong-passphrase"
$env:SEED_SUPERADMIN_NAME="Your Name"
npm run seed:superadmin
```

Rules the script enforces:

- `SEED_SUPERADMIN_PASSWORD` must be at least 12 characters.
- It refuses to run if a `superadmin` account already exists, or if the email is
  already registered.
- It reads `MONGO_URI` from `server/.env`, same as the app.

After it succeeds: go to `/login`, sign in with that email and password. You are
sent to `/superadmin`.

## Day-to-day: managing admin accounts

Open **`/superadmin`** (there is no link to it anywhere — type the path). You must
be signed in as the superadmin; any other role is bounced to the home page.

### Create an admin

1. Fill in the staff member's **full name**, their **PESO email**, and a
   **purpose / identity note** (e.g. `"Ma. Santos, PESO Manager"`). The note is
   required so months later you can tell whose account each one is.
2. Submit. A **one-time temporary password** is shown once, in a green banner,
   with a **Copy** button.
3. Give that password to the staff member (in person / phone / however you
   normally do). It is **not stored in readable form** and will not be shown
   again — if it's lost, use **Reset** (below).

### First sign-in by the new admin

- They go to `/login`, enter their email + the temporary password.
- They are forced to the **Set your password** screen before they can reach any
  other page. They choose their own password there.
- After that they land on `/admin` as a normal admin. The temporary password no
  longer works.

### Disable / re-enable an admin

- **Disable** (someone leaves the PESO office, or an account is compromised): the
  account's `isActive` is set to false. On their next request or login they get a
  plain *"This staff account has been disabled. Contact the system superadmin."* —
  **not** the resident suspension/appeal wall.
- **Enable** reverses it. Nothing is deleted; their password is unchanged.

### Reset an admin's password

Issues a fresh one-time temporary password (shown once) and forces the
change-password screen again on their next sign-in. Use this if a password was
lost or you suspect it leaked but want to keep the account.

## What a normal admin sees

Nothing changes for existing admins except:

- The "change role" dropdown in User Management no longer offers **Admin**.
- They never see your superadmin account in any list or count.
- They can't delete other admin accounts anymore (that error now says staff
  accounts are managed by the superadmin).
- **Job postings can no longer be hard-deleted by admins** — only closed or
  rejected. The "Delete Job" button on the job detail page is gone. Permanent
  removal is a superadmin policy-takedown.
- Admins can now start a conversation with the superadmin from Messages (and
  the superadmin can reply); the superadmin appears in their user search.

## Deliberately left for later

These were scoped out of this pass and can be added without reworking the above:

- Email-delivered invite links (currently the temp password is shown on screen
  for you to pass on).
- TOTP / 2-factor on superadmin and admin logins.
- Login attempt throttling specific to staff accounts.
- JWT token-versioning so disabling an admin instantly kills an already-issued
  30-day token (today a disabled admin is blocked on their **next** request,
  which in practice is seconds later because the middleware re-checks the DB on
  every call).

## Files touched

**Server**

- `models/User.js` — `superadmin` role; `mustChangePassword`, `createdBySuperadmin`,
  `staffNote`, `lastLoginAt` fields.
- `middleware/auth.js` — `isSuperadmin`; `isAdmin` now also accepts `superadmin`;
  disabled staff get `ACCOUNT_DISABLED`, not the appeal wall.
- `controllers/authController.js` — `changePassword`; login records `lastLoginAt`
  and returns `mustChangePassword`; disabled-staff branch.
- `routes/authRoutes.js` — `POST /auth/change-password`.
- `controllers/superadminController.js`, `routes/superadminRoutes.js` — the console
  API (`GET/POST /superadmin/admins`, `PATCH /superadmin/admins/:id/active`,
  `POST /superadmin/admins/:id/reset-password`) plus `DELETE /superadmin/jobs/:id`
  (policy takedown).
- `controllers/adminController.js` — role-change locked to resident/employer;
  superadmin accounts hidden from listing, analytics, per-user view; admins can't
  delete staff accounts; `deleteJob` removed.
- `routes/adminRoutes.js` — `DELETE /admin/jobs/:id` removed.
- `controllers/messageController.js` — `superadmin` ↔ `admin`-only messaging.
- `server.js` — mounts `/superadmin`, adds it to the admin rate-limit bucket.
- `scripts/seedSuperadmin.js` + `npm run seed:superadmin`.

**Client**

- `pages/superadmin/SuperadminConsole.jsx` + `styles/superadmin-console.css` — the
  console (light-green theme). Renders inside the shared app sidebar.
- `pages/ChangePassword.jsx` — forced and voluntary password change.
- `components/Navbar.jsx` — dedicated `superadmin` sidebar menu; Notifications link
  hidden for superadmin; `superadmin` → `/superadmin` default route.
- `routes/ProtectedRoute.jsx` — `superadmin` default route; `mustChangePassword`
  redirect gate. Superadmin no longer blanket-inherits `admin` routes.
- `App.jsx` — `/superadmin` + `/change-password` routes; the technical admin routes
  widened to `["admin", "superadmin"]`, news/SPES stay `admin`-only; superadmin
  redirect from `/`.
- `pages/Login.jsx` — routes `superadmin` to `/superadmin`, temp-password users to
  `/change-password`.
- `pages/admin/JobMonitoring.jsx` + `styles/jobMonitoring.css` — superadmin variant
  (no KPIs/charts) + permanent-takedown modal.
- `pages/JobDetail.jsx` — removed the admin "Delete Job" button.
- `pages/ProfilePage.jsx` — superadmin uses the minimal admin profile layout.
- `components/TermsGate.jsx` — skips `superadmin` (as it already skipped `admin`).
- `services/api.js` — `authAPI.changePassword`, `superadminAPI` (+ `deleteJob`);
  `adminAPI.deleteJob` removed.
