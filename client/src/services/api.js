import axios from "axios";

const DEFAULT_API_URL = import.meta.env.DEV
  ? "http://localhost:3000/api/v1"
  : "https://stram-peso.onrender.com/api/v1";

export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

// Origin that serves uploaded assets (strip the trailing /api/vN)
export const ASSET_BASE_URL = API_URL.replace(/\/api\/v\d+\/?$/, "");

// A stored value that is a private storage ref (Cloudinary etc.) — not directly
// loadable; resolve it with filesAPI.getSignedUrl() first.
export const isPrivateFileRef = (value) =>
  typeof value === "string" && value.startsWith("cloudinary:");

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
  timeout: 30000,
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
      if (window.location.pathname !== "/account-suspended") {
        window.location.href = "/account-suspended";
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
        if (!publicPaths.some(path => currentPath === path || currentPath.startsWith('/auth'))) {
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
  google: (credential) => api.post('/auth/google', { credential }),
  requestEmailChange: (payload) => api.post('/auth/email-change/request', payload, getAuthHeader()),
  confirmEmailChange: (payload) => api.post('/auth/email-change/confirm', payload),
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
  createJob: (data) => api.post('/jobs', data, getAuthHeader()),
  getJobs: () => api.get('/jobs'),
  getHomepageJobs: () => api.get('/jobs/homepage'),
  searchJobsWithSemantic: (params) => api.get('/recommendations/jobs', { params }),
  getJobById: (id) => api.get(`/jobs/${id}`),
  updateJob: (id, data) => api.put(`/jobs/${id}`, data, getAuthHeader()),
  deleteJob: (id) => api.delete(`/jobs/${id}`, getAuthHeader()),
  applyToJob: (id, data) => api.post(`/jobs/${id}/apply`, data, getAuthFormHeader()),
  getEmployerJobs: () => api.get('/jobs/mine', getAuthHeader()),
  getApplicationsForJob: (id) => api.get(`/jobs/${id}/applications`, getAuthHeader()),
  getMyApplications: () => api.get('/jobs/applications/me', getAuthHeader()),
  updateApplication: (id, data) => api.put(`/jobs/applications/${id}`, data, getAuthFormHeader()),
  deleteApplication: (id) => api.delete(`/jobs/applications/${id}`, getAuthHeader()),
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
  getHomepageJobManagement: async () => {
    await delay(150);
    return api.get('/admin/jobs/homepage-display', getAuthHeader());
  },
  getAdminVacancies: (params = {}) => api.get('/admin/jobs', { ...getAuthHeader(), params }),
  getAdminVacancyStats: (params = {}) => api.get('/admin/jobs/stats', { ...getAuthHeader(), params }),
  toggleHomepageFeature: (id, isFeatured) =>
    api.put(`/admin/jobs/${id}/homepage-feature`, { isFeatured }, getAuthHeader()),
  updateJobStatus: (id, status) => api.put(`/admin/jobs/${id}/status`, { status }, getAuthHeader()),
  deleteJob: (id) => api.delete(`/admin/jobs/${id}`, getAuthHeader()),
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
  // Accepts either a bare status string (legacy) or a { decision, note } payload.
  updateEmployerVerification: (id, payload) =>
    api.put(
      `/admin/users/${id}/verification`,
      typeof payload === "string" ? { verificationStatus: payload } : payload,
      getAuthHeader()
    ),
  getVerificationQueue: (params = {}) =>
    api.get('/admin/users/verification-queue', { ...getAuthHeader(), params }),
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

// Employer document verification submission.
export const verificationAPI = {
  submit: () => api.post('/users/verification/submit', {}, getAuthHeader()),
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