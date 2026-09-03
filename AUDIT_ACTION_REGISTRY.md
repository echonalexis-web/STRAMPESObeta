# Comprehensive STRAM PESO Audit Action Registry

## Overview

This document provides a complete inventory of all user actions across the STRAM PESO platform that should be tracked in the audit system. Actions are organized by domain and user role, with severity levels and current implementation status.

**Last Updated:** 2026-09-02  
**Status:** Production-Ready Dictionary Created

---

## Executive Summary

### Total Action Categories: 15
### Total Documented Actions: 82+
### Currently Implemented (Backend Logging): 16 actions
### Future Implementation Ready: 66+ actions

---

## 1. AUTHENTICATION & ACCOUNT SECURITY

**Category:** `auth-security`  
**User Roles:** All (Guest, Admin, Employer, Jobseeker)  
**Severity Level:** Info (default), Warning (password changes)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `auth.user.registered` | User registered | info | ✅ Implemented | Resident/jobseeker account created |
| `auth.employer.registered` | Employer registered | info | ✅ Implemented | Employer account created |
| `auth.user.login_success` | User logged in | info | ✅ Implemented | User successfully authenticated |
| `auth.user.logout` | User logged out | info | 📋 Ready | User session terminated |
| `auth.password.reset_requested` | Password reset requested | warning | 📋 Ready | Password reset flow initiated |
| `auth.password.reset` | Password reset | warning | 📋 Ready | Password successfully reset |
| `auth.session.terminated` | Session terminated | info | 📋 Ready | Admin or system terminated user session |

**Notes:**
- Auth logging is critical for security compliance
- All auth events should be logged immediately
- Login success is already logged via `auth.user.login_success`

---

## 2. USER PROFILE & ACCOUNT MANAGEMENT

**Category:** `user-account`  
**User Roles:** All authenticated users  
**Severity Level:** Info, Warning (sensitive actions)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `user.profile.updated` | Profile updated | info | 📋 Ready | User updated personal/professional profile |
| `user.profile.onboarding_completed` | Onboarding completed | info | 📋 Ready | User completed initial onboarding flow |
| `user.profile_image.uploaded` | Profile image uploaded | info | 📋 Ready | User uploaded/changed profile picture |
| `user.resume.uploaded` | Resume uploaded | info | 📋 Ready | Jobseeker uploaded resume file |
| `user.password.changed` | Password changed | warning | 📋 Ready | User changed their account password |
| `user.account.deleted` | Account deleted by user | critical | 📋 Ready | User self-deleted their account |

**Controller Functions:**
- `authController.updateProfile()`
- `userController.completeOnboarding()`
- `userController.uploadProfileImage()`
- `userController.uploadResume()`
- `userController.changePassword()`
- `userController.deleteAccount()` / `authController.deleteAccount()`

---

## 3. JOB APPLICATION MANAGEMENT (Jobseeker)

**Category:** `applicant-jobs`  
**User Roles:** Resident/Jobseeker  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `job.application.created` | Job application submitted | info | 📋 Ready | Jobseeker applied to a job posting |
| `job.application.updated` | Job application updated | info | 📋 Ready | Jobseeker modified their application |
| `job.application.deleted` | Job application withdrawn | info | 📋 Ready | Jobseeker withdrew their application |
| `job.application.status_viewed` | Job application viewed by applicant | info | 📋 Ready | Jobseeker viewed their application status |

**Controller Functions:**
- `jobController.applyToJob()`
- `jobController.updateMyApplication()`
- `jobController.deleteMyApplication()`

---

## 4. JOB POSTING MANAGEMENT (Employer)

**Category:** `employer-management`  
**User Roles:** Employer  
**Severity Level:** Info, Warning (deletions)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `employer.job.created` | Job posted | info | 📋 Ready | Employer created a new job posting |
| `employer.job.updated` | Job updated | info | 📋 Ready | Employer modified job details |
| `employer.job.deleted` | Job deleted | warning | 📋 Ready | Employer permanently deleted a job |
| `employer.job.closed` | Job closed | info | 📋 Ready | Employer closed a job (accepting applications) |
| `employer.job.reopened` | Job reopened | info | 📋 Ready | Employer reopened a previously closed job |
| `employer.job.archived` | Job archived | info | 📋 Ready | Employer archived a job for historical record |

**Controller Functions:**
- `employerController.createJob()` / `jobController.createJob()`
- `employerController.updateJob()` / `jobController.updateJob()`
- `employerController.deleteJob()` / `jobController.deleteJob()`
- `jobController.closeJob()`
- `jobController.reopenJob()`
- `jobController.archiveJob()`

---

## 5. APPLICATION STATUS MANAGEMENT (Employer)

**Category:** `employer-management`  
**User Roles:** Employer  
**Severity Level:** Info, Warning (hiring decisions)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `employer.application.status_updated` | Application status updated | info | 📋 Ready | Employer changed an applicant's status |
| `employer.application.bulk_status_updated` | Bulk application status update | info | 📋 Ready | Employer updated multiple applications at once |
| `employer.application.reviewed` | Application marked as reviewed | info | 📋 Ready | Employer reviewed an application |
| `employer.application.shortlisted` | Application shortlisted | info | 📋 Ready | Employer shortlisted a candidate |
| `employer.application.rejected` | Application rejected | info | 📋 Ready | Employer rejected an application |
| `employer.application.hired` | Applicant hired | warning | 📋 Ready | Employer made a job offer/hired candidate |
| `employer.application.note_added` | Employer note added to application | info | 📋 Ready | Employer added private notes to application |

**Controller Functions:**
- `employerController.updateApplicationStatus()`
- `employerController.bulkUpdateApplicationStatuses()`

---

## 6. ADMIN - USER MANAGEMENT

**Category:** `user-management`  
**User Roles:** Admin  
**Severity Level:** Warning (default), Critical (deletion, deactivation)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `admin.user.role_updated` | User role updated | warning | ✅ Implemented | Admin changed a user's role (resident/employer/admin) |
| `admin.user.deactivated` | User account deactivated | critical | ✅ Implemented | Admin deactivated a user account |
| `admin.user.reactivated` | User account reactivated | warning | ✅ Implemented | Admin reactivated a deactivated account |
| `admin.user.verification_updated` | Employer verification status updated | warning | ✅ Implemented | Admin changed employer verification status |
| `admin.user.verified` | Employer verified | warning | 📋 Ready | Admin verified an employer account |
| `admin.user.verification_revoked` | Employer verification revoked | warning | 📋 Ready | Admin removed employer verification |
| `admin.user.deleted` | User permanently deleted | critical | ✅ Implemented | Admin permanently deleted a user account |
| `admin.user.viewed` | Admin viewed user profile | info | 📋 Ready | Admin accessed user profile details |

**Controller Functions:**
- `adminController.updateUserRole()`
- `adminController.deactivateUser()`
- `adminController.reactivateUser()`
- `adminController.updateEmployerVerification()`
- `adminController.deleteUser()`
- `adminController.getUserProfileDetails()`

---

## 7. ADMIN - JOB MANAGEMENT

**Category:** `job-management`  
**User Roles:** Admin  
**Severity Level:** Info, Warning (deletions)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `admin.job.deleted` | Job deleted by admin | warning | ✅ Implemented | Admin deleted a job posting |
| `admin.job.status_updated` | Job status changed | info | ✅ Implemented | Admin changed job active/closed status |
| `admin.job.featured_enabled` | Job featured on homepage | info | ✅ Implemented | Admin enabled homepage feature for job |
| `admin.job.featured_disabled` | Job removed from homepage | info | ✅ Implemented | Admin disabled homepage feature for job |
| `admin.job.archived` | Job archived by admin | info | 📋 Ready | Admin archived a job |

**Controller Functions:**
- `adminController.deleteJob()`
- `adminController.updateJobStatus()`
- `adminController.toggleHomepageFeature()`

---

## 8. ADMIN - NEWS & ANNOUNCEMENTS

**Category:** `news-announcements`  
**User Roles:** Admin  
**Severity Level:** Info, Warning (deletions)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `admin.news.created` | News announcement created | info | ✅ Implemented | Admin created a news post |
| `admin.news.updated` | News announcement updated | warning | ✅ Implemented | Admin modified a news post |
| `admin.news.deleted` | News announcement deleted | warning | ✅ Implemented | Admin deleted a news post |
| `admin.news.published` | News announcement published | info | 📋 Ready | Admin published a news post |
| `admin.news.unpublished` | News announcement unpublished | warning | 📋 Ready | Admin unpublished a news post |
| `admin.news.archived` | News announcement archived | info | 📋 Ready | Admin archived a news post |

**Controller Functions:**
- `newsController.createNews()`
- `newsController.updateNews()`
- `newsController.deleteNews()`

---

## 9. ADMIN - AUDIT & ANALYTICS

**Category:** `audit-analytics`  
**User Roles:** Admin  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `admin.audit.logs_viewed` | Audit logs viewed | info | 📋 Ready | Admin accessed audit trail logs |
| `admin.analytics.dashboard_accessed` | Analytics dashboard accessed | info | 📋 Ready | Admin viewed analytics dashboard |
| `admin.verification_queue.reviewed` | Verification queue reviewed | info | 📋 Ready | Admin reviewed verification queue |

**Controller Functions:**
- `adminController.getAuditLogs()`
- `adminController.getAdminAnalytics()`
- `adminController.getVerificationQueue()`

---

## 10. MESSAGING & COMMUNICATION

**Category:** `messaging`  
**User Roles:** All authenticated users  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `message.conversation.created` | Conversation started | info | 📋 Ready | User initiated a new conversation |
| `message.sent` | Message sent | info | 📋 Ready | User sent a message |
| `message.read` | Message read | info | 📋 Ready | User read a message |
| `message.conversation.deleted` | Conversation deleted | info | 📋 Ready | User deleted a conversation |
| `message.conversation.archived` | Conversation archived | info | 📋 Ready | User archived a conversation |

**Controller Functions:**
- `messageController.createConversation()`
- `messageController.sendMessage()`
- `messageController.deleteConversation()`

**Note:** Message read events are high-volume and may need sampling/batching for performance.

---

## 11. SOCIAL INTERACTIONS - FOLLOW SYSTEM

**Category:** `social-interactions`  
**User Roles:** All authenticated users  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `social.user.followed` | User followed | info | 📋 Ready | User followed another user |
| `social.user.unfollowed` | User unfollowed | info | 📋 Ready | User unfollowed another user |

**Controller Functions:**
- `followController.followUser()`
- `followController.unfollowUser()`

---

## 12. SOCIAL INTERACTIONS - JOB INTERACTIONS

**Category:** `job-interactions`  
**User Roles:** Jobseeker/Resident  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `social.job.liked` | Job liked | info | 📋 Ready | User liked/saved a job posting |
| `social.job.unliked` | Job unliked | info | 📋 Ready | User removed job from liked/saved |
| `social.job.bookmarked` | Job bookmarked | info | 📋 Ready | User bookmarked a job posting |
| `social.job.unbookmarked` | Job removed from bookmarks | info | 📋 Ready | User removed bookmark from job |

**Controller Functions:**
- `jobLikeController.likeJob()`
- `jobLikeController.unlikeJob()`

---

## 13. NOTIFICATION SYSTEM

**Category:** `notifications`  
**User Roles:** All authenticated users  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `notification.sent` | Notification sent | info | 📋 Ready | System sent notification to user |
| `notification.read` | Notification marked as read | info | 📋 Ready | User marked notification as read |
| `notification.marked_all_read` | All notifications marked as read | info | 📋 Ready | User marked all notifications as read |
| `notification.deleted` | Notification deleted | info | 📋 Ready | User deleted a notification |
| `notification.archived` | Notification archived | info | 📋 Ready | User archived a notification |

**Controller Functions:**
- `notificationController.markNotificationRead()`
- `notificationController.markAllNotificationsRead()`
- `notificationController.deleteNotification()`

**Note:** Notification.sent events are system-generated and high-volume; may require separate analytics pipeline.

---

## 14. SEARCH & DISCOVERY

**Category:** `search-discovery`  
**User Roles:** All users (logged-in and guest)  
**Severity Level:** Info

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `search.jobs_searched` | Jobs search performed | info | 📋 Ready | User performed job search/filter |
| `search.users_searched` | Users search performed | info | 📋 Ready | User searched for other users |
| `search.recommendations_viewed` | Recommendations viewed | info | 📋 Ready | User viewed personalized recommendations |

**Controller Functions:**
- `recommendationController.hybridSearch()`
- `messageController.searchUsers()`

**Note:** High-volume events; recommend sampling for production analytics.

---

## 15. SYSTEM & BACKGROUND OPERATIONS

**Category:** `system-maintenance`  
**User Roles:** System/Admin  
**Severity Level:** Info, Warning (maintenance)

| Action Key | Label | Severity | Status | Description |
|---|---|---|---|---|
| `system.scheduled_task.executed` | Scheduled task executed | info | 📋 Ready | Automated job/task completed |
| `system.database.backup` | Database backup created | info | 📋 Ready | System created database backup |
| `system.security.scan` | Security scan completed | warning | 📋 Ready | Security scan/audit completed |
| `system.maintenance.started` | System maintenance started | warning | 📋 Ready | Admin initiated system maintenance |
| `system.maintenance.completed` | System maintenance completed | info | 📋 Ready | System maintenance finished |

---

## Implementation Roadmap

### Phase 1: Core Actions (Already Implemented ✅)
- ✅ auth.user.registered
- ✅ auth.employer.registered
- ✅ auth.user.login_success
- ✅ admin.user.role_updated
- ✅ admin.user.deactivated
- ✅ admin.user.reactivated
- ✅ admin.user.verification_updated
- ✅ admin.user.deleted
- ✅ admin.job.deleted
- ✅ admin.job.status_updated
- ✅ admin.job.featured_enabled
- ✅ admin.job.featured_disabled
- ✅ admin.news.created
- ✅ admin.news.updated
- ✅ admin.news.deleted

### Phase 2: High Priority (Recommended for Next Sprint)
- 📋 user.password.changed
- 📋 user.account.deleted
- 📋 job.application.created
- 📋 job.application.deleted
- 📋 employer.job.created
- 📋 employer.job.updated
- 📋 employer.job.deleted
- 📋 employer.application.status_updated
- 📋 message.sent
- 📋 message.conversation.created

### Phase 3: Medium Priority (Next Quarters)
- 📋 All user profile actions
- 📋 All social interaction actions
- 📋 All notification actions
- 📋 Search and discovery analytics

### Phase 4: Low Priority (Future Enhancement)
- 📋 System maintenance actions
- 📋 Background job actions
- 📋 Session management

---

## Usage Guidelines

### For Developers

1. **When adding new features**, refer to this registry to identify if audit logging is needed
2. **Use the `logAuditEvent()` service** in [server/services/auditService.js](../server/services/auditService.js)
3. **Choose the correct severity** level based on the action impact
4. **Document the action** in this registry before implementation

### For Frontend Audit UI

1. Import utilities from [client/src/utils/auditConstants.js](../client/src/utils/auditConstants.js)
2. Use `formatAuditAction()` to display human-readable action labels
3. Use `getAuditActionCategory()` for filtering
4. Use `getAuditCategories()` to populate dropdown filters

### For Compliance & Security

1. All admin actions with "critical" or "warning" severity must be logged
2. All authentication events must be logged immediately
3. All data deletions must be logged with full context
4. Retention policy: audit logs retained for minimum 90 days (configurable)

---

## Notes & Future Enhancements

### Performance Considerations
- High-volume actions (messages, notifications, search) should use async logging with batching
- Consider sampling strategy for analytics vs compliance logging
- Implement log rotation and archival policies

### Security Considerations
- All audit logs should be immutable once created
- Access to audit logs should be restricted to admins
- Consider encrypting sensitive metadata
- Regular audit log reviews should be part of security procedures

### Compliance
- GDPR: User deletion should follow data retention policies
- SOC 2: All critical actions must be logged and auditable
- Documentation: This registry serves as audit system documentation

---

## Related Files

- Audit Service: [server/services/auditService.js](../server/services/auditService.js)
- Audit Constants: [client/src/utils/auditConstants.js](../client/src/utils/auditConstants.js)
- Audit Trail UI: [client/src/pages/admin/AuditTrail.jsx](../client/src/pages/admin/AuditTrail.jsx)
- Audit Model: [server/models/AuditLog.js](../server/models/AuditLog.js)

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-02  
**Maintained By:** Development Team
