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
    
    if (error.response?.status === 429 && !originalRequest._retry) {
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
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (payload) => api.post('/auth/reset-password', payload),
  // `intent` ("employer" | "jobseeker") is only honoured when the Google account
  // is brand new — it decides which role/profile the account is created with.
  google: (credential, intent) => api.post('/auth/google', { credential, intent }),
  requestEmailChange: (payload) => api.post('/auth/email-change/request', payload, getAuthHeader()),
  confirmEmailChange: (payload) => api.post('/auth/email-change/confirm', payload),
  resendEmailVerification: (email) => api.post('/auth/verify-email/resend', { email }),
  confirmEmailVerification: (payload) => api.post('/auth/verify-email/confirm', payload),
  registerEmployee: (data) => api.post('/auth/register/employee', data),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
  getProfile: () => api.get('/auth/profile', getAuthHeader()),
  updateProfile: (data) => api.put('/auth/profile', data, getAuthFormHeader()),
  updateAvatar: (file) => {
    const fd = new FormData();
    fd.append('profileImage', file);
    return api.patch('/auth/profile/avatar', fd, getAuthFormHeader());
  },
  registerEmployer: (data) => api.post('/auth/register/employer', data),
  acceptTerms: (version) => api.post('/auth/accept-terms', { version }, getAuthHeader()),
  changePassword: (payload) => api.post('/auth/change-password', payload, getAuthHeader()),
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
  listAdmins: () => api.get('/superadmin/admins', getAuthHeader()),
  createAdmin: (payload) => api.post('/superadmin/admins', payload, getAuthHeader()),
  setAdminActive: (id, active) =>
    api.patch(`/superadmin/admins/${id}/active`, { active }, getAuthHeader()),
  resetAdminPassword: (id) =>
    api.post(`/superadmin/admins/${id}/reset-password`, {}, getAuthHeader()),
  // Permanent policy-violation takedown of a job posting (superadmin only).
  deleteJob: (id, reason) =>
    api.delete(`/superadmin/jobs/${id}`, { ...getAuthHeader(), data: { reason } }),
  // Settings → System Preferences
  getSystemSettings: () => api.get('/superadmin/system-settings', getAuthHeader()),
  updateSystemSettings: (payload) => api.put('/superadmin/system-settings', payload, getAuthHeader()),
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
  searchJobsWithSemantic: (params, config = {}) => api.get('/recommendations/jobs', { params, ...config }),
  getJobById: (id) => api.get(`/jobs/${id}`),
  applyToJob: (id, data) => api.post(`/jobs/${id}/apply`, data, getAuthFormHeader()),
  getApplicationsForJob: (id) => api.get(`/jobs/${id}/applications`, getAuthHeader()),
  getMyApplications: (params = {}, config = {}) => api.get('/jobs/applications/me', { ...getAuthHeader(), params, ...config }),
  updateApplication: (id, data) => api.put(`/jobs/applications/${id}`, data, getAuthFormHeader()),
  deleteApplication: (id) => api.delete(`/jobs/applications/${id}`, getAuthHeader()),
};

// Jobseeker's private library of saved resumes / cover letters — never
// visible to employers until one is attached to a submitted application.
export const jobseekerDocumentAPI = {
  list: (kind) => api.get('/jobseeker/documents', { ...getAuthHeader(), params: kind ? { kind } : {} }),
  upload: ({ file, kind, title, source, onProgress }) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('kind', kind);
    if (title) fd.append('title', title);
    if (source) fd.append('source', source);
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
  getUsers: async (params = {}) => {
    await delay(150);
    return api.get('/admin/users', { ...getAuthHeader(), params });
  },
  getAnalytics: async () => {
    await delay(150);
    return api.get('/admin/analytics', getAuthHeader());
  },
  getProvincialAnalytics: (params = {}) => api.get('/admin/analytics/provincial', { ...getAuthHeader(), params }),
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
  deleteUser: (id) => api.delete(`/admin/users/${id}`, getAuthHeader()),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
};

export const newsAPI = {
  list: (params = {}) => api.get('/news', { params }),
  listAdmin: (params = {}) => api.get('/news', { ...getAuthHeader(), params: { ...params, includeInactive: true } }),
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
  unsendMessage: (messageId) => api.patch(`/messages/${messageId}/unsend`, {}, getAuthHeader()),
  deleteConversation: (conversationId) => api.delete(`/messages/conversations/${conversationId}`, getAuthHeader()),
  getUnreadCount: () => api.get('/messages/unread-count', getAuthHeader()),
};

export const employerAPI = {
  getStats: () => api.get('/employer/stats', getAuthHeader()),
  getProfileStats: () => api.get('/employer/profile-stats', getAuthHeader()),
  getJobs: () => api.get('/employer/jobs', getAuthHeader()),
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
  getMine: () => api.get('/spes/applications', getAuthHeader()),
  getForAnnouncement: (announcementId) => api.get(`/spes/${announcementId}/me`, getAuthHeader()),
  getResults: (announcementId) => api.get(`/spes/${announcementId}/results`, getAuthHeader()),
  apply: (announcementId, formData) =>
    api.post(`/spes/${announcementId}/apply`, formData, getAuthFormHeader()),
  adminList: (params = {}) => api.get('/spes/admin/list', { ...getAuthHeader(), params }),
  adminGet: (id) => api.get(`/spes/admin/${id}`, getAuthHeader()),
  adminRecordEvaluation: (id, payload) =>
    api.patch(`/spes/admin/${id}/evaluation`, payload, getAuthHeader()),
  adminAmendResult: (id, payload) => api.patch(`/spes/admin/${id}/result`, payload, getAuthHeader()),
  adminReleaseResults: (announcementId, payload = {}) =>
    api.post(`/spes/admin/announcements/${announcementId}/release-results`, payload, getAuthHeader()),
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