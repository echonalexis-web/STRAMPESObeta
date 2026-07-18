import axios from "axios";

const DEFAULT_API_URL = import.meta.env.DEV
  ? "http://localhost:3000/api/v1"
  : "https://stram-peso.onrender.com/api/v1";

export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

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

// Helper function for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API Objects
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  registerEmployee: (data) => api.post('/auth/register/employee', data),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
  getProfile: () => api.get('/auth/profile', getAuthHeader()),
  updateProfile: (data) => api.put('/auth/profile', data, getAuthFormHeader()),
  deleteAccount: () => api.delete('/auth/profile', getAuthHeader()),
  registerEmployer: (data) => api.post('/auth/register/employer', data),
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
  getHomepageJobManagement: async () => {
    await delay(150);
    return api.get('/admin/jobs/homepage-display', getAuthHeader());
  },
  toggleHomepageFeature: (id, isFeatured) =>
    api.put(`/admin/jobs/${id}/homepage-feature`, { isFeatured }, getAuthHeader()),
  updateUserRole: (id, role) => api.put(`/admin/users/${id}/role`, { role }, getAuthHeader()),
  deactivateUser: (id) => api.put(`/admin/users/${id}/deactivate`, {}, getAuthHeader()),
  reactivateUser: (id) => api.put(`/admin/users/${id}/reactivate`, {}, getAuthHeader()),
  updateEmployerVerification: (id, verificationStatus) =>
    api.put(`/admin/users/${id}/verification`, { verificationStatus }, getAuthHeader()),
  deleteUser: (id) => api.delete(`/admin/users/${id}`, getAuthHeader()),
  generateInvite: () => api.post('/auth/invite', {}, getAuthHeader()),
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
  getApplicantsForJob: (jobId) => api.get(`/employer/jobs/${jobId}/applicants`, getAuthHeader()),
  getRankedApplicants: (jobId, params = {}) => 
    api.get(`/employer/jobs/${jobId}/applicants/ranked`, { ...getAuthHeader(), params }),
  updateApplicationStatus: (applicationId, data) => 
    api.put(`/employer/applications/${applicationId}/status`, data, getAuthHeader()),
};

export const usersAPI = {
  completeOnboarding: (data) => api.put('/users/onboarding', data, getAuthHeader()),
};

export default api;