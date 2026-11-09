# Pagination audit (client/src)

Read-only audit of every screen that renders a collection, done before adding the shared
pagination. "Server" means the API already takes `page` and `limit`; "whole list" means it
returns everything and the client would have to slice. Nothing in `server/` was changed.

Status key: **Has** (already paginated), **Client** (client-side pagination needed),
**Server-API** (needs an API change; client-side now), **N/A** (not paginated by design).

## Already paginated (each with its own look)

| Screen (file) | Role | Items | Data loading | Realistic size | Existing control | Status |
|---|---|---|---|---|---|---|
| Job board (`pages/JobBoard.jsx`) | jobseeker | vacancies | `searchJobsWithSemantic` with `page`, `limit` | hundreds | Previous / "Page x of y" / Next | Has (different look) |
| Your applications (`pages/YourApplications.jsx`) | jobseeker | job applications | `getMyApplications` page/limit | tens | custom prev/next | Has (different look) |
| Dashboard recommended jobs (`pages/Dashboard.jsx`) | jobseeker | recommended vacancies | whole list, sliced client-side (`recPage`) | tens | `.jsd-pager` prev/next | Has (different look) |
| Employer job listings and applicants (`pages/EmployerDashboard.jsx`) | employer | jobs, archived jobs, applicants | whole lists sliced client-side (`paginatedJobs`, applicants pages) | tens to hundreds | custom page buttons | Has (different look) |
| User management (`pages/admin/UserManagement.jsx`) | admin | users | `getUsers` page/limit | thousands | `.um-pagination` | Has (different look) |
| Employer verification (`pages/admin/EmployerVerification.jsx`) | admin | verification queue | `getQueue` page/limit | hundreds | own pager with `buildPageList` | Has (different look) |
| Job monitoring (`pages/admin/JobMonitoring.jsx`) | admin | vacancies | `getAdminVacancies` page/limit | thousands | "Page x of y" | Has (different look) |
| Audit trail (`pages/admin/AuditTrail.jsx`) | admin | audit events | page/limit | many thousands | `.admin-audit-pagination` (has its own `getPaginationItems`) | Has (different look) |
| Moderation queues: reports and appeals (`pages/admin/ModerationQueues.jsx`) | admin | reports, appeals | page/limit | hundreds | local `Pagination` (`.mq-pagination`) | Has (different look) |
| Reports tables (`pages/admin/Reports.jsx`) | admin | users, vacancies | page/limit | thousands | own prev/next | Has (different look) |
| Account recovery queue (`pages/admin/AccountRecoveryQueue.jsx`) | admin | recovery requests | `staffRecoveryAPI.list(status, page)` | tens | prev / current / next (no total) | Has (different look, no total) |
| SPES Monitoring (`pages/admin/SpesApplications.jsx`) | admin | SPES applications | `adminList` page/limit/total | hundreds | shared `Pagination` | Has (shared component) |

These keep working untouched. They are the candidates to move to the shared component later;
most need a `total` that their API already returns (everything above except the recovery queue).

## Needs pagination

| Screen (file) | Role | Items | Data loading | Realistic size | Plan | Status |
|---|---|---|---|---|---|---|
| Notifications page (`pages/Notifications.jsx`) | all signed in | notifications | `useNotifications({ initialLimit: 100 })`, whole list in memory | up to 100 loaded | slice the filtered list; the dropdown in the navbar stays a short "latest" list | Client (API follow-up: page/limit/total on `/notifications`) |
| SPES postings feed (`pages/SpesPostings.jsx`) | jobseeker | posting cards | `spesAPI.listPostings` returns all | tens | slice the filtered cards (default 9) | Client |
| My SPES applications (`pages/MySpesApplications.jsx`) | jobseeker | applications | `spesAPI.getMine` returns all | a few, rarely more than ten | slice the filtered, sorted rows | Client |
| SPES postings admin (`pages/admin/SpesPostingsAdmin.jsx`) | admin | postings | `adminPostings` returns all (optional `status`) | tens | slice | Client (API follow-up) |
| News management (`pages/admin/NewsFeedManagement.jsx`) | admin | announcements | `newsAPI.listAdmin({ page: 1, limit: 20 })`, API returns `totalPages` | hundreds | use the API's `page`/`limit` (it shows only the first 20 today) | Server-side (API exists, UI never paged) |
| Saved / favorited jobs (`pages/ProfilePage.jsx`, Favorites tab) | jobseeker | liked vacancies | `jobLikeAPI.getLikedJobs({ page: 1, limit: 60 })` (API pages, UI loads the first 60 only) | up to 60 loaded | slice the loaded list; follow-up: page through the API so favorites beyond 60 are reachable | Client |
| Liked news (`pages/ProfilePage.jsx`, Likes tab) | jobseeker, employer | liked announcements | `newsLikeAPI.getLiked({ page: 1, limit: 60 })` | up to 60 loaded | slice the loaded list | Client |
| Admin accounts (`pages/superadmin/SuperadminConsole.jsx`) | superadmin | admin accounts | `listAdmins` returns all | tens | slice the filtered list | Client |

## Not paginated, with reasons

| Screen | Why |
|---|---|
| Public news feed (`pages/NewsFeed.jsx`) | Feed-shaped: featured item plus a card grid, loads the latest 30 for the chosen category and search. If it needs more later, a "Load more" button fits better than page numbers. API already takes page/limit. |
| Notification dropdown (navbar) | Short "latest" list by design. |
| Messages: conversation list and chat history (`pages/Messages.jsx`) | A sidebar of conversations and a scrolling thread; chat history is a scroll surface, not a table. |
| Dashboards (`Dashboard.jsx` cards, `AdminDashboard.jsx`, `ProvincialAnalyticsOverview.jsx`) | Stat cards, charts and "top 3 / top 4" teasers, short and fixed. |
| Admin user moderation tabs (`UserModeration.jsx`) | Tab switcher over the queues above. |
| Profile page sections (`ProfilePage.jsx`) | The IntersectionObserver is a section spy, not a list. The Favorites and Likes tabs are lists and are listed above. |
| Follows | No follows list screen exists in the client (follow state shows as a button on cards and profiles). |
| Selects, dropdown options, tab sets, filter option lists, apply-modal documents, skeleton rows | Fixed or short by design. |

## Server-side follow-ups (not done in this run)

| Endpoint | Proposed change | Risk |
|---|---|---|
| `GET /notifications` | Accept `page`, `limit`, return `total`, `totalPages` (keep today's shape under `items` or the current key) | The navbar bell and the page share the hook; keep `limit` default so the bell is unchanged. |
| `GET /spes/postings` (applicant) and `GET /spes/admin/postings` | Accept `page`, `limit`, return `total` | Counts per status currently come from the unpaged list; keep them in a separate `counts` field. |
| `GET /spes/applications` (mine) | Accept `page`, `limit`, return `total` | Low; the list is short. |
| `GET /jobs/liked` and `GET /news/liked` | Return `total` / `totalPages` so the UI can page past 60 | Low; the endpoints already accept page and limit. |
| `GET /superadmin/admins` | Accept `page`, `limit`, return `total` | Low. |

## Questions

None. No item needs a decision before it can be done.

## Unification candidates

The twelve already-paginated screens above each draw their own previous/next and page
buttons (`.um-pagination`, `.mq-pagination`, `.admin-audit-pagination`, `.jsd-pager`,
`.recovery-queue__pager`, plain "Page x of y"). They behave the same but look different; the
shared `Pagination` can replace them one by one.
