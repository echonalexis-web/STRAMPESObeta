/**
 * Comprehensive Audit Action Labels and Categories
 * Maps internal action strings to human-readable labels
 * Organized by domain and entity type
 */

export const AUDIT_ACTION_LABELS = {
  // ============================================
  // AUTHENTICATION & ACCOUNT
  // ============================================
  "auth.user.registered": "User registered",
  "auth.employer.registered": "Employer registered",
  "auth.user.login_success": "User logged in",
  "auth.user.logout": "User logged out",
  "auth.password.reset_requested": "Password reset requested",
  "auth.password.reset": "Password reset",
  "auth.session.terminated": "Session terminated",

  // ============================================
  // USER PROFILE & ACCOUNT MANAGEMENT
  // ============================================
  "user.profile.updated": "Profile updated",
  "user.profile.onboarding_completed": "Onboarding completed",
  "user.profile_image.uploaded": "Profile image uploaded",
  "user.resume.uploaded": "Resume uploaded",
  "user.password.changed": "Password changed",
  "user.account.deleted": "Account deleted by user",

  // ============================================
  // JOB APPLICATIONS (Jobseeker/Applicant)
  // ============================================
  "job.application.created": "Job application submitted",
  "job.application.updated": "Job application updated",
  "job.application.deleted": "Job application withdrawn",
  "job.application.status_viewed": "Job application viewed by applicant",

  // ============================================
  // JOB MANAGEMENT (Employer)
  // ============================================
  "employer.job.created": "Job posted",
  "employer.job.updated": "Job updated",
  "employer.job.deleted": "Job deleted",
  "employer.job.closed": "Job closed",
  "employer.job.reopened": "Job reopened",
  "employer.job.archived": "Job archived",

  // ============================================
  // APPLICATION STATUS MANAGEMENT (Employer)
  // ============================================
  "employer.application.status_updated": "Application status updated",
  "employer.application.bulk_status_updated": "Bulk application status update",
  "employer.application.reviewed": "Application marked as reviewed",
  "employer.application.shortlisted": "Application shortlisted",
  "employer.application.rejected": "Application rejected",
  "employer.application.hired": "Applicant hired",
  "employer.application.note_added": "Employer note added to application",

  // ============================================
  // ADMIN - USER MANAGEMENT
  // ============================================
  "admin.user.role_updated": "User role updated",
  "admin.user.deactivated": "User account deactivated",
  "admin.user.reactivated": "User account reactivated",
  "admin.user.verification_updated": "Employer verification status updated",
  "admin.user.verified": "Employer verified",
  "admin.user.verification_revoked": "Employer verification revoked",
  "admin.user.deleted": "User permanently deleted",
  "admin.user.viewed": "Admin viewed user profile",

  // ============================================
  // ADMIN - JOB MANAGEMENT
  // ============================================
  "admin.job.deleted": "Job deleted by admin",
  "admin.job.status_updated": "Job status changed",
  "admin.job.featured_enabled": "Job featured on homepage",
  "admin.job.featured_disabled": "Job removed from homepage",
  "admin.job.archived": "Job archived by admin",

  // ============================================
  // ADMIN - NEWS & ANNOUNCEMENTS
  // ============================================
  "admin.news.created": "News announcement created",
  "admin.news.updated": "News announcement updated",
  "admin.news.deleted": "News announcement deleted",
  "admin.news.published": "News announcement published",
  "admin.news.unpublished": "News announcement unpublished",
  "admin.news.archived": "News announcement archived",

  // ============================================
  // ADMIN - AUDIT & ANALYTICS
  // ============================================
  "admin.audit.logs_viewed": "Audit logs viewed",
  "admin.analytics.dashboard_accessed": "Analytics dashboard accessed",
  "admin.verification_queue.reviewed": "Verification queue reviewed",

  // ============================================
  // MESSAGING & COMMUNICATION
  // ============================================
  "message.conversation.created": "Conversation started",
  "message.sent": "Message sent",
  "message.read": "Message read",
  "message.conversation.deleted": "Conversation deleted",
  "message.conversation.archived": "Conversation archived",

  // ============================================
  // SOCIAL INTERACTIONS - FOLLOW SYSTEM
  // ============================================
  "social.user.followed": "User followed",
  "social.user.unfollowed": "User unfollowed",

  // ============================================
  // SOCIAL INTERACTIONS - JOB INTERACTIONS
  // ============================================
  "social.job.liked": "Job liked",
  "social.job.unliked": "Job unliked",
  "social.job.bookmarked": "Job bookmarked",
  "social.job.unbookmarked": "Job removed from bookmarks",

  // ============================================
  // NOTIFICATIONS
  // ============================================
  "notification.sent": "Notification sent",
  "notification.read": "Notification marked as read",
  "notification.marked_all_read": "All notifications marked as read",
  "notification.deleted": "Notification deleted",
  "notification.archived": "Notification archived",

  // ============================================
  // SEARCH & DISCOVERY (for analytics)
  // ============================================
  "search.jobs_searched": "Jobs search performed",
  "search.users_searched": "Users search performed",
  "search.recommendations_viewed": "Recommendations viewed",

  // ============================================
  // SYSTEM & BACKGROUND ACTIONS
  // ============================================
  "system.scheduled_task.executed": "Scheduled task executed",
  "system.database.backup": "Database backup created",
  "system.security.scan": "Security scan completed",
  "system.maintenance.started": "System maintenance started",
  "system.maintenance.completed": "System maintenance completed",
};

/**
 * Action category mapping for filtering
 * Used to group actions in audit trails
 */
export const AUDIT_ACTION_CATEGORIES = {
  "auth.": "auth-security",
  "user.": "user-account",
  "job.application.": "applicant-jobs",
  "employer.": "employer-management",
  "admin.user.": "user-management",
  "admin.job.": "job-management",
  "admin.news.": "news-announcements",
  "admin.audit.": "audit-analytics",
  "admin.verification_queue.": "user-management",
  "message.": "messaging",
  "notification.": "notifications",
  "social.user.": "social-interactions",
  "social.job.": "job-interactions",
  "search.": "search-discovery",
  "system.": "system-maintenance",
};

/**
 * Severity mapping for different action types
 * Helps identify high-risk or sensitive operations
 */
export const AUDIT_ACTION_SEVERITY = {
  // Critical actions
  "auth.user.registered": "info",
  "auth.employer.registered": "info",
  "auth.user.login_success": "info",
  "admin.user.deleted": "critical",
  "admin.user.deactivated": "critical",
  "admin.user.reactivated": "warning",
  "admin.user.role_updated": "warning",
  "admin.user.verification_updated": "warning",
  "admin.news.deleted": "warning",
  "admin.job.deleted": "warning",
  "user.account.deleted": "critical",
  "user.password.changed": "warning",

  // Warning level actions
  "employer.job.deleted": "warning",
  "employer.application.status_updated": "info",
  "message.sent": "info",
  "job.application.created": "info",

  // Info level actions (default)
};

/**
 * Get human-readable label for an audit action
 * @param {string} action - The action key (e.g., "auth.user.registered")
 * @returns {string} - The human-readable label
 */
export const formatAuditAction = (value) => {
  const action = String(value || "").trim();
  if (!action) return "Unknown action";
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];

  // Fallback: convert action key to readable format
  return action
    .split(".")
    .filter(Boolean)
    .map((part) => part.replace(/_/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
};

/**
 * Determine the audit category for an action
 * @param {string} action - The action key
 * @returns {string} - The category key
 */
export const getAuditActionCategory = (action) => {
  const normalized = String(action || "").toLowerCase();

  // Check against category prefixes
  for (const [prefix, category] of Object.entries(AUDIT_ACTION_CATEGORIES)) {
    if (normalized.startsWith(prefix)) {
      return category;
    }
  }

  return "all";
};

/**
 * Get severity level for an action (if defined, default to "info")
 * @param {string} action - The action key
 * @returns {string} - The severity level ("info", "warning", "critical")
 */
export const getAuditActionSeverity = (action) => {
  return AUDIT_ACTION_SEVERITY[action] || "info";
};

/**
 * Get all action categories for filtering
 * @returns {Array<{value: string, label: string}>}
 */
export const getAuditCategories = () => {
  const uniqueCategories = new Set(Object.values(AUDIT_ACTION_CATEGORIES));
  return [
    { value: "all", label: "All Actions" },
    { value: "auth-security", label: "Auth & Security" },
    { value: "user-account", label: "User Account" },
    { value: "applicant-jobs", label: "Applicant Actions" },
    { value: "employer-management", label: "Employer Management" },
    { value: "user-management", label: "User Management" },
    { value: "job-management", label: "Job Management" },
    { value: "news-announcements", label: "News & Announcements" },
    { value: "audit-analytics", label: "Audit & Analytics" },
    { value: "messaging", label: "Messaging" },
    { value: "notifications", label: "Notifications" },
    { value: "social-interactions", label: "Social Interactions" },
    { value: "job-interactions", label: "Job Interactions" },
    { value: "search-discovery", label: "Search & Discovery" },
    { value: "system-maintenance", label: "System Maintenance" },
  ];
};

export default {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_CATEGORIES,
  AUDIT_ACTION_SEVERITY,
  formatAuditAction,
  getAuditActionCategory,
  getAuditActionSeverity,
  getAuditCategories,
};
