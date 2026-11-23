import axios from "axios";

const DEFAULT_API_URL = import.meta.env.DEV
  ? "http://localhost:3000/api/v1"
  : "https://strampesobeta.onrender.com/api/v1";

export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

// Origin that serves uploaded assets (strip the trailing /api/vN)
export const ASSET_BASE_URL = API_URL.replace(/\/api\/v\d+\/?$/, "");

// A stored value that is a private storage ref (Cloudinary etc.) — not directly
// loadable; resolve it with filesAPI.getSignedUrl() first.
export const isPrivateFileRef = (value) =>
  typeof value === "string" && value.startsWith("cloudinary:");

// Human-readable name for a stored file value. Private refs encode the
// original filename (and, for files uploaded before that was tracked, a
// public_id fallback) as base64url JSON with no path separators, so the old
// "split on / and take the last segment" trick just returned the raw ref.
export const displayFileName = (value) => {
  if (!value) return "";
  if (isPrivateFileRef(value)) {
    try {
      const b64 = value.slice("cloudinary:".length).replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "===".slice((b64.length + 3) % 4);
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const ref = JSON.parse(new TextDecoder().decode(bytes));
      if (ref?.n) return ref.n;
      if (ref?.p) return String(ref.p).split("/").pop();
    } catch {
      /* fall through to generic label */
    }
    return "Uploaded file";
  }
  return String(value).replace(/\\/g, "/").split("/").pop().split("?")[0];
};

// Turn a stored image path into a loadable URL. Absolute URLs pass through;
// server-relative "/uploads/..." paths get the API origin prefixed.
// Private refs return "" (caller must use filesAPI.getSignedUrl).
export const resolveAssetUrl = (value) => {
  if (!value) return "";
  if (isPrivateFileRef(value)) return "";
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:")) return value;
  return `${ASSET_BASE_URL}${value.startsWith("/") ? "" : "/"}${value}`;
};

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 90000,
});

// Request interceptor - Add token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error("Request interceptor error:", error);
    return Promise.reject(error);
  }
);

// A page like the Dashboard fires several authenticated requests in
// parallel (profile, stats, notifications, messages, ...). When the account
// backing all of them stops being valid mid-session, every single one of
// those requests rejects with the same 403 at roughly the same moment —
// and `window.location.pathname` does NOT update the instant `.href` is
// assigned (browser navigation is asynchronous), so a naive per-request
// `if (window.location.pathname !== "/login") window.location.href = "/login"`
// guard sees the *old* pathname on every one of them and reassigns
// `location.href` again, and again. Reassigning it mid-navigation can abort
// and restart the in-flight page load in some browsers, which is exactly
// what a "flickering between the old page and the login screen" report
// looks like. This flag makes only the first rejection in a batch actually
// act; every other one in the same batch is a no-op.
let isHandlingAccountInactive = false;
export const claimAccountInactiveHandling = () => {
  if (isHandlingAccountInactive) return false;
  isHandlingAccountInactive = true;
  return true;
};

// Response interceptor - Handle errors and retry on rate limit
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (originalRequest._retryCount >= 3) {
      console.error("Max retry attempts reached for:", originalRequest.url);
      return Promise.reject(error);
    }
    
    if (error.response?.status === 429 && !error.response?.data?.code && !originalRequest._retry) {
      originalRequest._retry = true;
      const retryCount = originalRequest._retryCount || 0;
      originalRequest._retryCount = retryCount + 1;
      
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`⏳ Rate limited (429). Retrying in ${delay}ms... (attempt ${retryCount + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return api(originalRequest);
      }
    }
    
    // Account suspended mid-session — the API now returns a structured 403.
    // Move the user to the suspension wall instead of a generic error.
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === "ACCOUNT_SUSPENDED"
    ) {
      if (window.location.pathname !== "/account-suspended" && claimAccountInactiveHandling()) {
        const data = error.response.data;
        if (data.appealToken) {
          localStorage.setItem("appealToken", data.appealToken);
        }
        localStorage.setItem(
          "suspensionInfo",
          JSON.stringify({
            accountStatus: data.accountStatus || "suspended",
            suspensionReason: data.suspensionReason || null,
            suspendedAt: data.suspendedAt || null,
          })
        );
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/account-suspended";
      }
      return Promise.reject(error);
    }

    // Account self-deactivated (in another session/tab), a staff account
    // disabled, or the account deleted outright — all mid-session. None of
    // these get the suspension/appeal wall; just sign out and explain why on
    // the login screen. Grouped into one branch (rather than three near-
    // identical ones) so they share a single claimAccountInactiveHandling()
    // guard instead of three independent, easy-to-desync copies of it.
    const NO_APPEAL_CODES = {
      ACCOUNT_DEACTIVATED: "Your account was deactivated. Sign in again to reactivate it.",
      ACCOUNT_DISABLED: "This staff account has been disabled. Contact the system superadmin.",
      ACCOUNT_DELETED: "This account no longer exists.",
      SESSION_EXPIRED: "Your session has expired. Please sign in again.",
    };
    if (error.response?.status === 403 && error.response?.data?.code in NO_APPEAL_CODES) {
      if (window.location.pathname !== "/login" && claimAccountInactiveHandling()) {
        const code = error.response.data.code;
        localStorage.setItem("authNotice", error.response.data.message || NO_APPEAL_CODES[code]);
        // Lets the login screen word the notice accurately (an expired session
        // is not a suspension or deactivation).
        localStorage.setItem("authNoticeCode", code);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      const token = localStorage.getItem("token");
      if (token) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        // The server now answers an expired or invalid token with 401 (it used
        // to be a 403 that nothing here acted on). Clearing storage alone
        // leaves AuthContext's in-memory user/token pointing at the dead
        // session on pages that don't redirect (public paths below), so tell
        // it to drop them too. No redirect loop is possible: the token is
        // already gone, so later requests send none and never reach this branch.
        window.dispatchEvent(new Event("auth:session-ended"));
        const publicPaths = ['/login', '/register', '/', '/home'];
        const currentPath = window.location.pathname;
        // Same batching hazard as the 403 branches above — a page that fires
        // several requests at once can get several 401s back together, and
        // without this guard each one would redundantly reassign
        // location.href, racing/restarting the same navigation. The claim is
        // only taken right here, immediately before the one redirect that
        // will actually happen — never on a path where no redirect follows
        // — so it can't get "used up" by a no-op and then wrongly suppress a
        // later, genuine redirect later in the same page session.
        if (
          !publicPaths.some(path => currentPath === path || currentPath.startsWith('/auth')) &&
          claimAccountInactiveHandling()
        ) {
          console.log("🔒 Unauthorized, redirecting to login");
          window.location.href = "/login";
        }
      }
    }
    
    if (error.code === "ERR_NETWORK" || error.code === "ECONNABORTED") {
      console.error("Network error:", error.message);
    }
    
    return Promise.reject(error);
  }
);

// Helper functions for headers
const getAuthHeader = () => {
  const token = localStorage.getItem("token");
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  };
};

const getAuthFormHeader = () => {
  const token = localStorage.getItem("token");
  return {
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
};

// Header carrying the short-lived "appeal-only" token issued at login when
// the account is suspended.
const getAppealHeader = () => {
  const appealToken = localStorage.getItem("appealToken");
  return {
    headers: {
      Authorization: `Bearer ${appealToken}`,
      "Content-Type": "application/json",
    },
  };
};

// Helper function for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API Objects
export const staffRecoveryAPI = {
  submit: (data) => api.post('/account-recovery-requests', data),
  verifyContact: (token) => api.post('/account-recovery-requests/verify-contact', { token }),
  finish: (token, newPassword) => api.post('/account-recovery-requests/finish', { token, newPassword }),
  list: (status, page = 1) => api.get('/account-recovery-requests', { ...getAuthHeader(), params: { status, page } }),
  detail: (id) => api.get(`/account-recovery-requests/${id}`, getAuthHeader()),
  review: (id, payload) => api.post(`/account-recovery-requests/${id}/review`, payload, getAuthHeader()),
  resend: (id, currentPassword) => api.post(`/account-recovery-requests/${id}/resend`, { currentPassword }, getAuthHeader()),
  report: (page = 1) => api.get('/account-recovery-requests/report', { ...getAuthHeader(), params: { page } }),
};

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  // `useRecoveryEmail: true` asks the server to deliver the reset link to
  // the account's verified recovery email instead of its primary one (for
  // when the primary inbox is itself unreachable) — silently falls back to
  // primary server-side if no verified recovery email exists, so this is
  // always safe to pass.
  forgotPassword: (emailOrUsername, useRecoveryEmail = false) =>
    api.post('/auth/forgot-password', { email: emailOrUsername, identifier: emailOrUsername, useRecoveryEmail }),
  // Username sign-up: signed form token (honeypot + minimum submit time).
  getSignupToken: () => api.get('/auth/signup-token'),
  // Neutral answer always; the username is mailed only to a verified email.
  forgotUsername: (email) => api.post('/auth/forgot-username', { email }),
  // Add a first email to a username-only account. Needs the current password.
  requestAddEmail: (payload) => api.post('/auth/email/add/request', payload, getAuthHeader()),
  // Success returns a fresh { token, user }: the old token is no longer valid.
  verifyAddEmail: (code) => api.post('/auth/email/add/verify', { code }, getAuthHeader()),
  resetPassword: (payload) => api.post('/auth/reset-password', payload),
  // Staff activation link (public). The token never goes in a URL: it is sent in the body.
  checkActivation: (token) => api.post('/auth/activate-account/check', { token }),
  activateAccount: (payload) => api.post('/auth/activate-account', payload),
  // `intent` ("employer" | "jobseeker") is only honoured when the Google account
  // is brand new — it decides which role/profile the account is created with.
  // `confirmAdult` is the employer 18+ attestation (ignored for jobseekers).
  google: (credential, intent, confirmAdult) =>
    api.post('/auth/google', { credential, intent, ...(confirmAdult ? { confirmAdult: true } : {}) }),
  // Step 2 for a first-time jobseeker: the pendingToken from google() plus a date of birth.
  googleComplete: (pendingToken, dateOfBirth) => api.post('/auth/google/complete', { pendingToken, dateOfBirth }),
  // Legacy accounts with no date of birth: set once, then locked.
  setMyDateOfBirth: (dateOfBirth) => api.post('/users/me/dob', { dateOfBirth }, getAuthHeader()),
  requestEmailChange: (payload) => api.post('/auth/email-change/request', payload, getAuthHeader()),
  confirmEmailChange: (payload) => api.post('/auth/email-change/confirm', payload),
  resendEmailVerification: (email) => api.post('/auth/verify-email/resend', { email }),
  confirmEmailVerification: (payload) => api.post('/auth/verify-email/confirm', payload),
  registerEmployee: (data) => api.post('/auth/register/employee', data),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
  getProfile: () => api.get('/auth/profile', getAuthHeader()),
  getIdFormats: () => api.get('/auth/id-formats', getAuthHeader()),
  confirmIdOcr: (payload) => api.post('/auth/id-ocr/confirm', payload, getAuthHeader()),
  updateProfile: (data) => api.put('/auth/profile', data, getAuthFormHeader()),
  updateAvatar: (file) => {
    const fd = new FormData();
    fd.append('profileImage', file);
    return api.patch('/auth/profile/avatar', fd, getAuthFormHeader());
  },
  // Profile banner: a preset template id, or null to reset to the default.
  setCover: (templateId) => api.put('/auth/profile/cover', { templateId }, getAuthHeader()),
  // Pick a preset avatar by id (jobseekers), or null to clear the choice.
  setAvatarPreset: (presetId) => api.put('/auth/profile/avatar/preset', { presetId }, getAuthHeader()),
  registerEmployer: (data) => api.post('/auth/register/employer', data),
  acceptTerms: (version) => api.post('/auth/accept-terms', { version }, getAuthHeader()),
  changePassword: (payload) => api.post('/auth/change-password', payload, getAuthHeader()),
  // Add a password to a Google-only account. `credential` is a FRESH Google
  // ID token (not the session JWT) — the server checks it matches this
  // account's linked googleId before accepting the new password.
  setPassword: (credential, newPassword) =>
    api.post('/auth/set-password', { credential, newPassword }, getAuthHeader()),
  // Live availability check — public, rate-limited server-side (10/min/IP).
  checkUsernameAvailable: (u) => api.get('/auth/username-available', { params: { u } }),
  setUsername: (username) => api.post('/auth/username', { username }, getAuthHeader()),
  // Account recovery — recovery email (Settings → Security). Requires
  // currentPassword re-auth server-side.
  requestRecoveryEmail: (recoveryEmail, currentPassword) =>
    api.post('/auth/recovery-email/request', { recoveryEmail, currentPassword }, getAuthHeader()),
  confirmRecoveryEmail: (payload) => api.post('/auth/recovery-email/confirm', payload),
  // Account recovery — backup codes (Settings → Security). `codes` in the
  // response exists only in this one call's lifetime — never fetchable again.
  generateBackupCodes: () => api.post('/auth/backup-codes/generate', {}, getAuthHeader()),
  // The recovery path itself — no session. `recoveryToken` from a
  // successful redeem is a short-lived, narrowly-scoped token (NOT a normal
  // session) good only for recoverSetPassword below.
  redeemBackupCode: (identifier, code) => api.post('/auth/recover/backup-code', { identifier, code }),
  recoverSetPassword: (recoveryToken, newPassword) =>
    api.post(
      '/auth/recover/set-password',
      { newPassword },
      { headers: { Authorization: `Bearer ${recoveryToken}`, 'Content-Type': 'application/json' } }
    ),
  exportNsrpForm1: () => api.get('/auth/nsrp-form-1/export', { ...getAuthHeader(), responseType: 'blob' }),
  exportNsrpForm2: () => api.get('/auth/nsrp-form-2/export', { ...getAuthHeader(), responseType: 'blob' }),
  // Saves a Resume Studio-generated PDF as the profile's official resume
  // file, via the lightweight /auth/me patch route (no other profile fields
  // are touched).
  uploadGeneratedResume: (blob, filename) => {
    const fd = new FormData();
    fd.append('resume', blob, filename);
    return api.patch('/auth/me', fd, getAuthFormHeader());
  },
  // Settings → Notifications + Privacy
  getSettings: () => api.get('/auth/settings', getAuthHeader()),
  updateSettings: (payload) => api.put('/auth/settings', payload, getAuthHeader()),
  // Settings → Danger Zone
  deactivateAccount: (password) => api.post('/auth/deactivate', { password }, getAuthHeader()),
};

// Superadmin console — provisioning and lifecycle of LMDPESO admin accounts.
// Every call requires the "superadmin" role server-side.
export const superadminAPI = {
  uploadNsrpTemplate: (form, file) => {
    const fd = new FormData();
    fd.append('template', file);
    return api.put('/superadmin/system-settings/nsrp-templates/' + form, fd, { ...getAuthFormHeader(), responseType: 'blob' });
  },
  downloadNsrpSample: (form) => api.get('/superadmin/system-settings/nsrp-templates/' + form + '/sample', { ...getAuthHeader(), responseType: 'blob' }),
  getNsrpTemplateMeta: (form) => api.get('/superadmin/system-settings/nsrp-templates/' + form + '/meta', getAuthHeader()),
  listAdmins: () => api.get('/superadmin/admins', getAuthHeader()),
  createAdmin: (payload) => api.post('/superadmin/admins', payload, getAuthHeader()),
  setAdminActive: (id, active) =>
    api.patch(`/superadmin/admins/${id}/active`, { active }, getAuthHeader()),
  resetAdminPassword: (id) =>
    api.post(`/superadmin/admins/${id}/reset-password`, {}, getAuthHeader()),
  // Staff invite: a fresh activation email (the old link stops working), or cancel
  // a pending account that was never activated.
  resendAdminInvite: (id) =>
    api.post(`/superadmin/admins/${id}/resend-invite`, {}, getAuthHeader()),
  cancelAdminInvite: (id) =>
    api.delete(`/superadmin/admins/${id}/invite`, getAuthHeader()),
  // Permanent policy-violation takedown of a job posting (superadmin only).
  deleteJob: (id, reason) =>
    api.delete(`/superadmin/jobs/${id}`, { ...getAuthHeader(), data: { reason } }),
  // Settings → System Preferences
  getSystemSettings: () => api.get('/superadmin/system-settings', getAuthHeader()),
  updateSystemSettings: (payload) => api.put('/superadmin/system-settings', payload, getAuthHeader()),
  // Configurable job-matching weights (§C.1) — per-criterion {min, max}
  // bounds every employer/admin weight profile must fall within.
  // NOTE: server endpoint not implemented yet — see
  // markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this calls.
  getMatchWeightBounds: () => api.get('/admin/match-weight-bounds', getAuthHeader()),
  updateMatchWeightBounds: (payload) => api.put('/admin/match-weight-bounds', payload, getAuthHeader()),
};

// Suspension appeal — authenticated with the appeal-only token.
export const appealAPI = {
  getMine: () => api.get('/appeals/me', getAppealHeader()),
  submit: (message) => api.post('/appeals', { message }, getAppealHeader()),
};

// User reports (policy violations).
export const reportAPI = {
  create: (payload) => api.post('/reports', payload, getAuthHeader()),
};

export const jobAPI = {
  getJobs: () => api.get('/jobs'),
  getHomepageJobs: () => api.get('/jobs/homepage'),
  // Signed-out visitors: public fields only, newest first. Filters use the same names as Browse Jobs.
  getPublicJobs: (params, config = {}) => api.get('/jobs/public', { params, ...config }),
  getPublicJob: (id, config = {}) => api.get(`/jobs/public/${id}`, config),
  searchJobsWithSemantic: (params, config = {}) => api.get('/recommendations/jobs', { params, ...config }),
  suggestJobs: (q, config = {}) => api.get('/recommendations/jobs/suggest', { params: { q }, ...config }),
  getJobById: (id) => api.get(`/jobs/${id}`),
  applyToJob: (id, data) => api.post(`/jobs/${id}/apply`, data, getAuthFormHeader()),
  getApplicationsForJob: (id) => api.get(`/jobs/${id}/applications`, getAuthHeader()),
  getMyApplications: (params = {}, config = {}) => api.get('/jobs/applications/me', { ...getAuthHeader(), params, ...config }),
  updateApplication: (id, data) => api.put(`/jobs/applications/${id}`, data, getAuthFormHeader()),
  deleteApplication: (id) => api.delete(`/jobs/applications/${id}`, getAuthHeader()),
  // Per-vacancy job-matching weight override (§C.1) — employer, own jobs
  // only. `updateMatchWeights` saves/replaces the override;
  // `resetMatchWeights` removes it so the job falls back to the employer's
  // own default profile. NOTE: server endpoint not implemented yet — see
  // markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this calls.
  getMatchWeights: (id) => api.get(`/jobs/${id}/match-weights`, getAuthHeader()),
  updateMatchWeights: (id, payload) => api.put(`/jobs/${id}/match-weights`, payload, getAuthHeader()),
  resetMatchWeights: (id) => api.delete(`/jobs/${id}/match-weights`, getAuthHeader()),
};

// Jobseeker's private library of saved resumes / cover letters — never
// visible to employers until one is attached to a submitted application.
export const jobseekerDocumentAPI = {
  list: (kind) => api.get('/jobseeker/documents', { ...getAuthHeader(), params: kind ? { kind } : {} }),
  upload: ({ file, kind, title, source, sourceJobId, onProgress }) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('kind', kind);
    if (title) fd.append('title', title);
    if (source) fd.append('source', source);
    if (sourceJobId) fd.append('sourceJobId', sourceJobId);
    return api.post('/jobseeker/documents/upload', fd, {
      ...getAuthFormHeader(),
      onUploadProgress: onProgress
        ? (event) => onProgress(event.total ? Math.round((event.loaded * 100) / event.total) : 0)
        : undefined,
    });
  },
  setPrimary: (id) => api.patch(`/jobseeker/documents/${id}/primary`, {}, getAuthHeader()),
  remove: (id) => api.delete(`/jobseeker/documents/${id}`, getAuthHeader()),
};

export const adminAPI = {
  // Username-only accounts: counts only, and unlocking a locked-out jobseeker.
  getAccountSecuritySummary: () => api.get('/admin/accounts/security-summary', getAuthHeader()),
  unlockLogin: (id, reason) => api.put(`/admin/users/${id}/unlock-login`, { reason }, getAuthHeader()),
  // Staff-assisted reset at the counter (ID checked in person). The temporary
  // password comes back once in the response.
  resetUserPassword: (id, payload) => api.post(`/admin/users/${id}/reset-password`, payload, getAuthHeader()),
  getJob: (id) => api.get(`/admin/jobs/${id}`, getAuthHeader()),
  updateJob: (id, payload) => api.put(`/admin/jobs/${id}`, payload, getAuthHeader()),
  getUsers: async (params = {}) => {
    await delay(150);
    return api.get('/admin/users', { ...getAuthHeader(), params });
  },
  getAnalytics: async () => {
    await delay(150);
    return api.get('/admin/analytics', getAuthHeader());
  },
  getProvincialAnalytics: (params = {}) => api.get('/admin/analytics/provincial', { ...getAuthHeader(), params }),
  getReportCatalog: () => api.get('/admin/report-exports/catalog', getAuthHeader()),
  previewReportExport: (body) => api.post('/admin/report-exports/preview', body, getAuthHeader()),
  generateReportExport: (body) => api.post('/admin/report-exports', body, { ...getAuthHeader(), responseType: 'blob' }),
  listReportExports: (params = {}) => api.get('/admin/report-exports', { ...getAuthHeader(), params }),
  regenerateReportExport: (reportId) => api.post(`/admin/report-exports/${encodeURIComponent(reportId)}/regenerate`, {}, { ...getAuthHeader(), responseType: 'blob' }),
  getDashboardOverview: () => api.get('/admin/analytics/dashboard', getAuthHeader()),
  getAnalyticsOverview: (params = {}, config = {}) => api.get('/admin/analytics/overview', { ...getAuthHeader(), ...config, params }),
  getUserById: (id) => api.get(`/admin/users/${id}`, getAuthHeader()),
  exportUserNsrpForm1: (id) =>
    api.get(`/admin/users/${id}/nsrp-form-1/export`, { ...getAuthHeader(), responseType: 'blob' }),
  exportUserNsrpForm2: (id) =>
    api.get(`/admin/users/${id}/nsrp-form-2/export`, { ...getAuthHeader(), responseType: 'blob' }),
  getHomepageJobManagement: async () => {
    await delay(150);
    return api.get('/admin/jobs/homepage-display', getAuthHeader());
  },
  getAdminVacancies: (params = {}) => api.get('/admin/jobs', { ...getAuthHeader(), params }),
  getAdminVacancyStats: (params = {}) => api.get('/admin/jobs/stats', { ...getAuthHeader(), params }),
  toggleHomepageFeature: (id, isFeatured) =>
    api.put(`/admin/jobs/${id}/homepage-feature`, { isFeatured }, getAuthHeader()),
  updateJobStatus: (id, status) => api.put(`/admin/jobs/${id}/status`, { status }, getAuthHeader()),
  updateUserRole: (id, role) => api.put(`/admin/users/${id}/role`, { role }, getAuthHeader()),
  deactivateUser: (id, options = {}) =>
    api.put(`/admin/users/${id}/deactivate`, {
      reason: options.reason || "",
      permanent: options.permanent === true,
    }, getAuthHeader()),
  reactivateUser: (id) => api.put(`/admin/users/${id}/reactivate`, {}, getAuthHeader()),
  // Moderation queue
  getReports: (params = {}) => api.get('/reports/admin', { ...getAuthHeader(), params }),
  resolveReport: (id, payload) => api.patch(`/reports/admin/${id}/resolve`, payload, getAuthHeader()),
  getAppeals: (params = {}) => api.get('/appeals/admin', { ...getAuthHeader(), params }),
  resolveAppeal: (id, payload) => api.patch(`/appeals/admin/${id}/resolve`, payload, getAuthHeader()),
  getAuditLogs: (params = {}) =>
    api.get('/admin/audit-logs', { ...getAuthHeader(), params }),
  // Soft delete: needs { reason, note?, confirm } (the typed username or email).
  deleteUser: (id, payload = {}) => api.delete(`/admin/users/${id}`, { ...getAuthHeader(), data: payload }),
  getDeletePreview: (id) => api.get(`/admin/users/${id}/delete-preview`, getAuthHeader()),
  restoreUser: (id) => api.post(`/admin/users/${id}/restore`, {}, getAuthHeader()),
  // CSV of the filtered directory (superadmin). Returns a blob.
  exportUsersCsv: (params = {}) =>
    api.get('/admin/users-export', { ...getAuthHeader(), params, responseType: 'blob' }),
  // Tab totals and filter-chip counts for both directories (superadmin).
  getUserDirectoryCounts: () => api.get('/admin/users-counts', getAuthHeader()),
  getUserInsights: (id) => api.get(`/admin/users/${id}/insights`, getAuthHeader()),
  saveUserNotes: (id, notes) => api.put(`/admin/users/${id}/notes`, { notes }, getAuthHeader()),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
  // Platform-default job-matching weight profile (§C.1) — the reset target
  // and starting point for every employer who hasn't customised their own.
  // NOTE: server endpoint not implemented yet — see
  // markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this calls.
  getMatchWeightDefaults: () => api.get('/admin/match-weight-defaults', getAuthHeader()),
  updateMatchWeightDefaults: (payload) => api.put('/admin/match-weight-defaults', payload, getAuthHeader()),
};

export const newsAPI = {
  list: (params = {}) => api.get('/news', { params }),
  listAdmin: (params = {}) => api.get('/news', { ...getAuthHeader(), params: { ...params, includeInactive: true } }),
  // Published announcements only, with page/limit/total (what News Management lists).
  listPublishedAdmin: (params = {}) => api.get('/news', { ...getAuthHeader(), params }),
  getById: (id) => api.get(`/news/${id}`),
  create: (data) =>
    data instanceof FormData
      ? api.post('/news', data, getAuthFormHeader())
      : api.post('/news', data, getAuthHeader()),
  update: (id, data) =>
    data instanceof FormData
      ? api.put(`/news/${id}`, data, getAuthFormHeader())
      : api.put(`/news/${id}`, data, getAuthHeader()),
  remove: (id) => api.delete(`/news/${id}`, getAuthHeader()),
};

export const filesAPI = {
  getLocalFile: (ref) => api.get(resolveAssetUrl(ref), { ...getAuthHeader(), responseType: 'blob' }),
  // Resolve a private storage ref to a short-lived signed URL
  getSignedUrl: (ref) => api.get('/files/signed-url', { ...getAuthHeader(), params: { ref } }),
};

export const newsCommentAPI = {
  list: (newsId) => api.get(`/news/${newsId}/comments`),
  create: (newsId, content) => api.post(`/news/${newsId}/comments`, { content }, getAuthHeader()),
  remove: (newsId, commentId) => api.delete(`/news/${newsId}/comments/${commentId}`, getAuthHeader()),
};

export const newsLikeAPI = {
  like: (newsId) => api.post(`/news-likes/${newsId}/like`, {}, getAuthHeader()),
  unlike: (newsId) => api.post(`/news-likes/${newsId}/unlike`, {}, getAuthHeader()),
  getLiked: (params = {}) => api.get('/news-likes/liked', { ...getAuthHeader(), params }),
  getStatus: (newsId) => api.get(`/news-likes/${newsId}/like-status`, getAuthHeader()),
};

export const messageAPI = {
  searchUsers: (query) => api.get('/messages/users/search', { ...getAuthHeader(), params: { query } }),
  createConversation: (data) => api.post('/messages/conversations', data, getAuthHeader()),
  getConversations: () => api.get('/messages/conversations', getAuthHeader()),
  getMessages: (conversationId) => api.get(`/messages/conversations/${conversationId}/messages`, getAuthHeader()),
  sendMessage: (conversationId, data) => api.post(`/messages/conversations/${conversationId}/messages`, data, getAuthHeader()),
  // "Share my contact details" for one conversation with an employer.
  getContactShare: (conversationId) => api.get(`/messages/conversations/${conversationId}/share-contact`, getAuthHeader()),
  shareContact: (conversationId, fields) => api.post(`/messages/conversations/${conversationId}/share-contact`, { fields }, getAuthHeader()),
  revokeContactShare: (conversationId) => api.delete(`/messages/conversations/${conversationId}/share-contact`, getAuthHeader()),
  unsendMessage: (messageId) => api.patch(`/messages/${messageId}/unsend`, {}, getAuthHeader()),
  deleteConversation: (conversationId) => api.delete(`/messages/conversations/${conversationId}`, getAuthHeader()),
  getUnreadCount: () => api.get('/messages/unread-count', getAuthHeader()),
};

export const employerAPI = {
  getStats: () => api.get('/employer/stats', getAuthHeader()),
  getProfileStats: () => api.get('/employer/profile-stats', getAuthHeader()),
  getJobs: () => api.get('/employer/jobs', getAuthHeader()),
  // Archived tab: closed jobs with server-computed status, funnel, hired people and stats.
  getArchivedJobs: (params, signal) => api.get('/employer/jobs/archived', { ...getAuthHeader(), params, signal }),
  createJob: (data) => api.post('/employer/jobs', data, getAuthHeader()),
  updateJob: (id, data) => api.put(`/employer/jobs/${id}`, data, getAuthHeader()),
  deleteJob: (id) => api.delete(`/employer/jobs/${id}`, getAuthHeader()),
  closeJob: (id) => api.post(`/jobs/${id}/close`, {}, getAuthHeader()),
  archiveJob: (id) => api.post(`/jobs/${id}/archive`, {}, getAuthHeader()),
  reopenJob: (id) => api.post(`/jobs/${id}/reopen`, {}, getAuthHeader()),
  getApplicantsForJob: (jobId) => api.get(`/employer/jobs/${jobId}/applicants`, getAuthHeader()),
  getRankedApplicants: (jobId, params = {}) => 
    api.get(`/employer/jobs/${jobId}/applicants/ranked`, { ...getAuthHeader(), params }),
  updateApplicationStatus: (applicationId, data) => 
    api.put(`/employer/applications/${applicationId}/status`, data, getAuthHeader()),
  bulkUpdateApplicationStatuses: (data) =>
    api.put('/employer/applications/bulk-status', data, getAuthHeader()),
  scheduleInterview: (applicationId, data) =>
    api.put(`/employer/applications/${applicationId}/interview`, data, getAuthHeader()),
  bulkScheduleInterview: (data) =>
    api.put('/employer/applications/bulk-interview', data, getAuthHeader()),
  markInterviewNoShow: (applicationId) =>
    api.put(`/employer/applications/${applicationId}/no-show`, {}, getAuthHeader()),
  getJobseekerProfile: (userId) => api.get(`/employer/jobseekers/${userId}`, getAuthHeader()),
  // Reusable qualification / skillset templates
  getQualificationTemplates: () =>
    api.get('/employer/qualification-templates', getAuthHeader()),
  createQualificationTemplate: (data) =>
    api.post('/employer/qualification-templates', data, getAuthHeader()),
  updateQualificationTemplate: (id, data) =>
    api.put(`/employer/qualification-templates/${id}`, data, getAuthHeader()),
  deleteQualificationTemplate: (id) =>
    api.delete(`/employer/qualification-templates/${id}`, getAuthHeader()),
  // Employer's default job-matching weight profile (§C.1) — applies to every
  // job this employer posts, unless a per-vacancy override exists (see
  // jobAPI.getMatchWeights/updateMatchWeights). `resetMatchWeights` removes
  // the employer's custom profile so they fall back to the admin/platform
  // default. NOTE: server endpoint not implemented yet — see
  // markdowns/MATCH_WEIGHTS_BACKEND_HANDOFF.md for the contract this calls.
  getMatchWeights: () => api.get('/employers/match-weights', getAuthHeader()),
  updateMatchWeights: (payload) => api.put('/employers/match-weights', payload, getAuthHeader()),
  resetMatchWeights: () => api.delete('/employers/match-weights', getAuthHeader()),
};

export const usersAPI = {
  completeOnboarding: (data) => api.put('/users/onboarding', data, getAuthHeader()),
};

// Employer verification — employer submits their docs; staff review the queue.
export const verificationAPI = {
  submit: () => api.post('/users/verification/submit', {}, getAuthHeader()),
  // Staff: pending-employer queue (admin + superadmin read; admin acts).
  getQueue: (params = {}) => api.get('/verification/queue', { ...getAuthHeader(), params }),
  // Accepts { decision: "approved" } or { decision: "rejected", note }.
  review: (id, payload) => api.patch(`/verification/${id}`, payload, getAuthHeader()),
  // Id-scoped approve/reject matching the documented admin API contract.
  approve: (id) => api.post(`/admin/employers/${id}/verification/approve`, {}, getAuthHeader()),
  reject: (id, reason) => api.post(`/admin/employers/${id}/verification/reject`, { reason }, getAuthHeader()),
  markUnderReview: (id) => api.post(`/admin/employers/${id}/verification/under-review`, {}, getAuthHeader()),
  requestResubmission: (id, reason) =>
    api.post(`/admin/employers/${id}/verification/resubmission-required`, { reason }, getAuthHeader()),
};

// Admin-maintainable option catalogs (item 11) — industry, jobType,
// governmentIdType. Reads are open to any authenticated role (the dropdowns
// need them); writes are superadmin-only, enforced server-side.
export const systemOptionsAPI = {
  list: (category, params = {}) => api.get(`/system-options/${category}`, { ...getAuthHeader(), params }),
  create: (payload) => api.post('/system-options', payload, getAuthHeader()),
  update: (id, payload) => api.put(`/system-options/${id}`, payload, getAuthHeader()),
  remove: (id) => api.delete(`/system-options/${id}`, getAuthHeader()),
};

// Profile banner templates. Any signed-in user reads the active list; the
// superadmin manages them (validated gradient and pattern definitions only).
// Profile viewing for every signed-in role: the hover card summary and the full
// profile for this viewer. Both answer 404 PROFILE_UNAVAILABLE for anything the
// viewer may not see.
export const profileViewAPI = {
  summary: (id, signal) => api.get(`/profiles/${id}/summary`, { ...getAuthHeader(), signal }),
  get: (id, signal) => api.get(`/profiles/${id}`, { ...getAuthHeader(), signal }),
  // An employer's open postings, for a jobseeker viewing the company page.
  jobs: (id, { page = 1, limit = 10 } = {}, signal) => api.get(`/profiles/${id}/jobs`, { ...getAuthHeader(), params: { page, limit }, signal }),
};

// Employer cover image (verified employers): upload a cropped image, or remove it.
export const employerCoverAPI = {
  uploadImage: (file, cropData, onProgress) => {
    const fd = new FormData();
    fd.append('cover', file);
    if (cropData) fd.append('cropData', JSON.stringify(cropData));
    return api.post('/employer/cover/image', fd, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
  },
  removeImage: () => api.delete('/employer/cover/image', getAuthHeader()),
};

export const bannerTemplateAPI = {
  listActive: () => api.get('/banner-templates', getAuthHeader()),
  adminList: () => api.get('/superadmin/banner-templates', getAuthHeader()),
  // Create and update are multipart: FormData with name, nameFil, isActive and (create
  // always, update optionally) the image file in the field "image".
  create: (formData, onProgress) =>
    api.post('/superadmin/banner-templates', formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
  update: (id, formData, onProgress) =>
    api.put(`/superadmin/banner-templates/${id}`, formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
  setActive: (id, isActive) => api.patch(`/superadmin/banner-templates/${id}/active`, { isActive }, getAuthHeader()),
  setDefault: (id) => api.patch(`/superadmin/banner-templates/${id}/default`, {}, getAuthHeader()),
  reorder: (ids) => api.put('/superadmin/banner-templates/order', { ids }, getAuthHeader()),
  // A template people use is deleted only with confirmUsage (the superadmin saw the count).
  remove: (id, { confirmUsage = false } = {}) =>
    api.delete(`/superadmin/banner-templates/${id}`, { ...getAuthHeader(), ...(confirmUsage ? { params: { confirmUsage: 'true' } } : {}) }),
  // Install the bundled banners: FormData with a "manifest" JSON field and the "images" files.
  installBuiltins: (formData, onProgress) =>
    api.post('/superadmin/banner-templates/builtins', formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
};

// Profile avatar presets: signed-in users read the active list, the superadmin manages
// them (uploaded SVG or PNG, rasterized by the server), a jobseeker picks one by id.
export const avatarPresetAPI = {
  listActive: () => api.get('/avatar-presets', getAuthHeader()),
  adminList: () => api.get('/superadmin/avatar-presets', getAuthHeader()),
  create: (formData, onProgress) =>
    api.post('/superadmin/avatar-presets', formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
  update: (id, formData, onProgress) =>
    api.put(`/superadmin/avatar-presets/${id}`, formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
  setActive: (id, isActive) => api.patch(`/superadmin/avatar-presets/${id}/active`, { isActive }, getAuthHeader()),
  reorder: (ids) => api.put('/superadmin/avatar-presets/order', { ids }, getAuthHeader()),
  remove: (id, { confirmUsage = false } = {}) =>
    api.delete(`/superadmin/avatar-presets/${id}`, { ...getAuthHeader(), ...(confirmUsage ? { params: { confirmUsage: 'true' } } : {}) }),
  installBuiltins: (formData, onProgress) =>
    api.post('/superadmin/avatar-presets/builtins', formData, {
      ...getAuthFormHeader(),
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    }),
};

// Employer self-service account endpoints (profile picture + the combined
// document-upload/submit-for-verification step) — id-scoped, reachable even
// before the account is verified.
export const employerAccountAPI = {
  uploadAvatar: (employerId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/employers/${employerId}/avatar`, fd, getAuthFormHeader());
  },
  submitVerification: (employerId, { businessPermit, registrationDoc } = {}) => {
    const fd = new FormData();
    if (businessPermit) fd.append('businessPermit', businessPermit);
    if (registrationDoc) fd.append('registrationDoc', registrationDoc);
    return api.post(`/employers/${employerId}/verification/submit`, fd, getAuthFormHeader());
  },
};

// SPES (Special Program for Employment of Students) applications.
export const spesAPI = {
  // Applicant: own applications, and the postings they can see (15 and older).
  getMine: () => api.get('/spes/applications', getAuthHeader()),
  listPostings: () => api.get('/spes/postings', getAuthHeader()),
  getPosting: (postingId) => api.get(`/spes/postings/${postingId}`, getAuthHeader()),
  getForPosting: (postingId) => api.get(`/spes/postings/${postingId}/me`, getAuthHeader()),
  getResults: (postingId) => api.get(`/spes/postings/${postingId}/results`, getAuthHeader()),
  getEligibility: (postingId) => api.get(`/spes/postings/${postingId}/eligibility`, getAuthHeader()),
  // `config` may carry { onUploadProgress, signal } for progress and cancel.
  apply: (postingId, formData, config = {}) =>
    api.post(`/spes/postings/${postingId}/apply`, formData, { ...getAuthFormHeader(), ...config }),
  replaceDocument: (postingId, slot, formData, config = {}) =>
    api.post(`/spes/postings/${postingId}/documents/${slot}`, formData, { ...getAuthFormHeader(), ...config }),
  withdraw: (postingId) => api.post(`/spes/postings/${postingId}/withdraw`, {}, getAuthHeader()),

  // Admin: postings.
  adminPostings: (params = {}) => api.get('/spes/admin/postings', { ...getAuthHeader(), params }),
  adminGetPosting: (postingId) => api.get(`/spes/admin/postings/${postingId}`, getAuthHeader()),
  adminCreatePosting: (payload) => api.post('/spes/admin/postings', payload, getAuthHeader()),
  adminUpdatePosting: (postingId, payload) => api.put(`/spes/admin/postings/${postingId}`, payload, getAuthHeader()),
  adminSetPostingStatus: (postingId, status, alsoPostToNews) =>
    api.patch(`/spes/admin/postings/${postingId}/status`, { status, alsoPostToNews }, getAuthHeader()),
  adminDeletePosting: (postingId) => api.delete(`/spes/admin/postings/${postingId}`, getAuthHeader()),
  adminUploadCover: (postingId, file, config = {}) => {
    const fd = new FormData();
    fd.append('cover', file);
    return api.post(`/spes/admin/postings/${postingId}/cover`, fd, { ...getAuthFormHeader(), ...config });
  },
  adminRemoveCover: (postingId) => api.delete(`/spes/admin/postings/${postingId}/cover`, getAuthHeader()),
  adminSetPostingClosed: (postingId, closed) =>
    api.patch(`/spes/admin/postings/${postingId}/closed`, { closed }, getAuthHeader()),
  adminReleaseSummary: (postingId) => api.get(`/spes/admin/postings/${postingId}/release-summary`, getAuthHeader()),
  adminReleaseResults: (postingId) => api.post(`/spes/admin/postings/${postingId}/release-results`, {}, getAuthHeader()),

  // Admin: monitoring (the application queue, review and evaluation).
  adminList: (params = {}) => api.get('/spes/admin/list', { ...getAuthHeader(), params }),
  adminGet: (id) => api.get(`/spes/admin/${id}`, getAuthHeader()),
  adminRecordEvaluation: (id, payload) =>
    api.patch(`/spes/admin/${id}/evaluation`, payload, getAuthHeader()),
  adminAmendResult: (id, payload) => api.patch(`/spes/admin/${id}/result`, payload, getAuthHeader()),
  adminVerifyDocument: (id, docId, payload) =>
    api.patch(`/spes/admin/${id}/documents/${docId}`, payload, getAuthHeader()),
};

export const notificationAPI = {
  getNotifications: (params = {}) => api.get('/notifications', { ...getAuthHeader(), params }),
  getUnreadCount: () => api.get('/notifications/unread-count', getAuthHeader()),
  markAsRead: (notificationId) => api.put(`/notifications/${notificationId}/read`, {}, getAuthHeader()),
  markAllAsRead: () => api.put('/notifications/mark-all-read', {}, getAuthHeader()),
  deleteNotification: (notificationId) => api.delete(`/notifications/${notificationId}`, getAuthHeader()),
};

export const followAPI = {
  followUser: (userId) => api.post(`/follows/${userId}/follow`, {}, getAuthHeader()),
  unfollowUser: (userId) => api.post(`/follows/${userId}/unfollow`, {}, getAuthHeader()),
  // Added authentication headers to getFollowers and getFollowing
  getFollowers: (userId, params = {}) => api.get(`/follows/${userId}/followers`, { ...getAuthHeader(), params }),
  getFollowing: (userId, params = {}) => api.get(`/follows/${userId}/following`, { ...getAuthHeader(), params }),
  getFollowStatus: (userId) => api.get(`/follows/${userId}/follow-status`, getAuthHeader()),
  getFollowerCounts: (userId) => api.get(`/follows/${userId}/counts`),
};

export const jobLikeAPI = {
  likeJob: (jobId) => api.post(`/job-likes/${jobId}/like`, {}, getAuthHeader()),
  unlikeJob: (jobId) => api.post(`/job-likes/${jobId}/unlike`, {}, getAuthHeader()),
  getLikedJobs: (params = {}) => api.get('/job-likes/liked', { ...getAuthHeader(), params }),
  getJobLikeStatus: (jobId) => api.get(`/job-likes/${jobId}/like-status`, getAuthHeader()),
  getJobLikeCount: (jobId) => api.get(`/job-likes/${jobId}/like-count`),
};

export default api;
