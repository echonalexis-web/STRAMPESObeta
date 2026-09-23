# STRAM-PESO Current Implemented-System DFD

This document is grounded in the code that exists in the repo today, especially the route mounts in [server/server.js](server/server.js), the route modules under [server/routes](server/routes), and the Mongoose collections in [server/models](server/models).

It intentionally does not describe the manual LMD-PESO Appendix H workflow or the earlier proposed design represented in the legacy DFD package. The current system includes the modules now implemented in the MERN app: auth/profile, job posting/search, job applications, recommendations, follows, job likes, messaging, notifications, news/announcements with likes and comments, SPES applications, reports, appeals, verification, admin/superadmin oversight, and audit logging.

## Data store legend used below

- D1 — User
- D2 — JobVacancy
- D3 — JobApplication
- D4 — SpesApplication
- D5 — Announcement
- D6 — Conversation
- D7 — Message
- D8 — Notification
- D9 — Follow
- D10 — JobLike
- D11 — NewsLike
- D12 — NewsComment
- D13 — Report
- D14 — Appeal
- D15 — AuditLog
- D16 — QualificationTemplate
- D17 — JobseekerProfile
- D18 — EmployerProfile
- D19 — JobseekerDocument

## 1) Context Diagram

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]
    L["LMD-PESO Staff / Admin"]
    S["Superadmin"]
    P0["0.0<br/>STRAM-PESO System<br/>Auth, jobs, applications, moderation"]

    D1["D1<br/>User"]
    D2["D2<br/>JobVacancy"]
    D3["D3<br/>JobApplication"]
    D4["D4<br/>SpesApplication"]
    D5["D5<br/>Announcement"]
    D6["D6<br/>Conversation"]
    D7["D7<br/>Message"]
    D8["D8<br/>Notification"]
    D9["D9<br/>Follow"]
    D10["D10<br/>JobLike"]
    D11["D11<br/>NewsLike"]
    D12["D12<br/>NewsComment"]
    D13["D13<br/>Report"]
    D14["D14<br/>Appeal"]
    D15["D15<br/>AuditLog"]
    D16["D16<br/>QualificationTemplate"]
    D17["D17<br/>JobseekerProfile"]
    D18["D18<br/>EmployerProfile"]
    D19["D19<br/>JobseekerDocument"]

    %% Applicant / Jobseeker inputs, grouped by functional cluster (maps to 1.0-8.0 in the Level 0 diagram)
    A -->|"name, email, password, DOB, profile fields, resume, cover letter"| P0
    A -->|"resume/cover-letter builder documents, saved document library actions"| P0
    A -->|"job search/apply actions"| P0
    A -->|"follow/like actions"| P0
    A -->|"messages"| P0
    A -->|"news engagement"| P0
    A -->|"SPES docs"| P0
    A -->|"reports/appeals"| P0

    %% Employer inputs, grouped by functional cluster (maps to 1.0, 2.0, 3.0, 5.0, 6.0)
    E -->|"company profile, verification documents"| P0
    E -->|"vacancy fields, qualification templates"| P0
    E -->|"applicant status updates"| P0
    E -->|"messages"| P0
    E -->|"news engagement"| P0

    %% LMD-PESO Staff/Admin inputs, grouped by functional cluster (maps to 1.0, 2.0, 6.0, 7.0, 8.0)
    L -->|"verification reviews, admin actions"| P0
    L -->|"job/vacancy moderation"| P0
    L -->|"news publishing/moderation"| P0
    L -->|"evaluation notes, SPES result decisions"| P0
    L -->|"report queue triage"| P0

    %% Superadmin inputs, grouped by functional cluster (maps to 2.0, 8.0, 9.0)
    S -->|"admin provisioning, role changes, account activation, audit review"| P0
    S -->|"moderation"| P0
    S -->|"job governance"| P0

    P0 -->|"JWT, account data, jobs list, application status, dashboard analytics, notifications"| A
    P0 -->|"employer dashboard, closed/open jobs, ranked applicants, verification status"| E
    P0 -->|"pending verifications, admin analytics, moderation queues, audit trail"| L
    P0 -->|"audit logs, user management actions, admin roster, role changes"| S

    P0 --> D1
    P0 --> D2
    P0 --> D3
    P0 --> D4
    P0 --> D5
    P0 --> D6
    P0 --> D7
    P0 --> D8
    P0 --> D9
    P0 --> D10
    P0 --> D11
    P0 --> D12
    P0 --> D13
    P0 --> D14
    P0 --> D15
    P0 --> D16
    P0 --> D17
    P0 --> D18
    P0 --> D19

    classDef actor fill:#e8f0fe,stroke:#1a73e8,stroke-width:1.5px,color:#111;
    classDef process fill:#e6f4ea,stroke:#137333,stroke-width:2px,color:#111;
    classDef store fill:#fff4e5,stroke:#b06000,stroke-width:2px,stroke-dasharray:6 4,color:#111;
    class A,E,L,S actor;
    class P0 process;
    class D1,D2,D3,D4,D5,D6,D7,D8,D9,D10,D11,D12,D13,D14,D15,D16,D17,D18,D19 store;
```

## 2) Level 0 Diagram

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]
    L["LMD-PESO Staff / Admin"]
    S["Superadmin"]

    P1["1.0<br/>Identity & Profile Management<br/>Register, sign in, update profile, verify employer, manage resume/cover-letter library"]
    P2["2.0<br/>Job Marketplace<br/>Browse, post, edit, feature, close jobs"]
    P3["3.0<br/>Application Handling<br/>Apply to jobs, track status, shortlist, hire"]
    P4["4.0<br/>Recommendation & Social Engagement<br/>Hybrid job search, follows, job likes"]
    P5["5.0<br/>Messaging & Notification Flow<br/>Create conversation, send message, unread count"]
    P6["6.0<br/>News & Announcement Flow<br/>Publish, comment, like, view updates"]
    P7["7.0<br/>SPES Program Lifecycle<br/>Apply, evaluate, release results"]
    P8["8.0<br/>Moderation & Compliance<br/>Reports, appeals, verification reviews"]
    P9["9.0<br/>Admin / Superadmin Oversight<br/>Role changes, audit log review, admin provisioning"]

    D1["D1<br/>User"]
    D2["D2<br/>JobVacancy"]
    D3["D3<br/>JobApplication"]
    D4["D4<br/>SpesApplication"]
    D5["D5<br/>Announcement"]
    D6["D6<br/>Conversation"]
    D7["D7<br/>Message"]
    D8["D8<br/>Notification"]
    D9["D9<br/>Follow"]
    D10["D10<br/>JobLike"]
    D11["D11<br/>NewsLike"]
    D12["D12<br/>NewsComment"]
    D13["D13<br/>Report"]
    D14["D14<br/>Appeal"]
    D15["D15<br/>AuditLog"]
    D16["D16<br/>QualificationTemplate"]
    D17["D17<br/>JobseekerProfile"]
    D18["D18<br/>EmployerProfile"]
    D19["D19<br/>JobseekerDocument"]

    A -->|"email, password, profile data, resume, cover letter, SPES application"| P1
    A -->|"resume/cover-letter library: builder-generated or uploaded document, set primary, delete"| P1
    A -->|"browse jobs, apply, follow, like, message"| P2
    A -->|"job application payload (resume/cover-letter file or saved library documentId), status check"| P3
    A -->|"job preferences, follow target, like action"| P4
    A -->|"message text, conversation IDs, inbox request"| P5
    A -->|"news article view, comment, like"| P6
    A -->|"SPES application, docs, applicant details"| P7
    A -->|"report submission, appeal request"| P8

    E -->|"company details, job posting, qualification templates, applicant review"| P2
    E -->|"application decision, shortlist, hire"| P3
    E -->|"job posting metrics, ranked candidates"| P4
    E -->|"message to applicant, inbox operations"| P5
    E -->|"announcement read, profile exposure"| P6
    E -->|"employer verification documents"| P1

    L -->|"staff verification queue, admin actions, announcement publishing"| P1
    L -->|"job review, feature toggle, vacancy status"| P2
    L -->|"application triage, SPES evaluation"| P3
    L -->|"admin moderation list, queue review"| P8
    L -->|"SPES evaluation & result release"| P7
    L -->|"news posting, moderation"| P6

    S -->|"admin provisioning, account activation, role management, audit review"| P9
    S -->|"superadmin moderation"| P8
    S -->|"job governance / admin job deletion"| P2

    P1 --> D1
    P1 --> D17
    P1 --> D18
    P1 --> D19
    P2 --> D2
    P2 --> D16
    P3 --> D3
    P3 --> D2
    P3 --> D19
    P4 --> D9
    P4 --> D10
    P4 --> D1
    P4 --> D2
    P5 --> D6
    P5 --> D7
    P5 --> D8
    P6 --> D5
    P6 --> D11
    P6 --> D12
    P7 --> D4
    P7 --> D5
    P8 --> D13
    P8 --> D14
    P8 --> D15
    P9 --> D1
    P9 --> D15

    classDef actor fill:#e8f0fe,stroke:#1a73e8,stroke-width:1.5px,color:#111;
    classDef process fill:#e6f4ea,stroke:#137333,stroke-width:2px,color:#111;
    classDef store fill:#fff4e5,stroke:#b06000,stroke-width:2px,stroke-dasharray:6 4,color:#111;
    class A,E,L,S actor;
    class P1,P2,P3,P4,P5,P6,P7,P8,P9 process;
    class D1,D2,D3,D4,D5,D6,D7,D8,D9,D10,D11,D12,D13,D14,D15,D16,D17,D18,D19 store;
```

## 3) Level 1 Exploded Diagrams

### 3.1 Process 1.0 — Identity, profile, and verification

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]
    L["LMD-PESO Staff / Admin"]

    P11["1.1<br/>Account creation & login<br/>register / login / change password / Google auth"]
    P12["1.2<br/>Profile persistence<br/>store resident and employer profile fields"]
    P13["1.3<br/>Employer verification review<br/>approve / reject pending documents"]
    P14["1.4<br/>Resume & cover-letter library<br/>builder/upload, list, set primary, delete jobseeker documents"]

    D1["D1<br/>User"]
    D17["D17<br/>JobseekerProfile"]
    D18["D18<br/>EmployerProfile"]
    D15["D15<br/>AuditLog"]
    D19["D19<br/>JobseekerDocument"]

    A -->|"register: name, email, password, DOB, terms acceptance"| P11
    A -->|"login: email, password / forgot: email / reset: token, new password / change: current + new password"| P11
    E -->|"register: company name, email, password"| P11

    D1 -->|"read: existing user by email (hashed password, role, isActive, verificationStatus)"| P11
    P11 -->|"write: create User {name, email, passwordHash, role, DOB}; update lastLoginAt, resetToken, password, email"| D1
    P11 -->|"write: create empty JobseekerProfile"| D17
    P11 -->|"write: create empty EmployerProfile"| D18
    P11 -->|"write: auth.user.registered / login_success / password_changed / password_reset_* / email_change_* event"| D15

    P11 -->|"JWT token, user{id, name, email, role, onboardingComplete}"| A
    P11 -->|"JWT token, user{id, name, email, role, verificationStatus}"| E

    A -->|"onboarding: skills, education, address, industries, avatar file, resume file"| P12
    E -->|"company name, address, industry, business permit file, registration doc file"| P12

    D17 -->|"read: existing jobseeker profile by userId"| P12
    D18 -->|"read: existing employer profile by userId"| P12
    P12 -->|"write: create/update JobseekerProfile {skills, education, address, industries, resumeUrl}"| D17
    P12 -->|"write: create/update EmployerProfile {companyName, address, industry, permitUrl, registrationDocUrl}"| D18
    P12 -->|"write: update User {avatar, businessPermitUrl, registrationDocUrl, hasCompletedOnboarding}"| D1

    P12 -->|"updated user + profile object"| A
    P12 -->|"updated user + profile object, verificationStatus"| E

    L -->|"queue filters (status, page); approve / reject decision + rejection reason"| P13
    D1 -->|"read: employers where verificationStatus = pending (name, email, permit/registration docs)"| P13
    P13 -->|"write: update User {verificationStatus, verificationNote}"| D1
    P13 -->|"write: admin.user.verification_updated event"| D15

    P13 -->|"queue items {items, total}"| L
    P13 -->|"approved / rejected / pending status"| E

    A -->|"upload: builder-generated or uploaded resume/cover-letter file, kind, title, source (builder/upload) / list: kind filter / set primary: documentId / delete: documentId"| P14
    D19 -->|"read: my documents by owner (+kind filter), existing-primary check before create, referenced-by-application check before delete"| P14
    P14 -->|"write: create JobseekerDocument {owner, kind: resume/coverLetter, title, storedValue, mimeType, sizeBytes, source, isPrimary}; unset/set isPrimary; delete document"| D19
    P14 -->|"document list, saved/updated/deleted document"| A
```

### 3.2 Process 2.0 — Job marketplace management

```mermaid
flowchart LR
    E["Employer"]
    A["Applicant / Jobseeker"]
    L["LMD-PESO Staff / Admin"]
    S["Superadmin"]

    P21["2.1<br/>Browse / search jobs<br/>public listing and homepage jobs"]
    P22["2.2<br/>Create / edit / archive jobs<br/>vacancy lifecycle and qualification templates"]
    P23["2.3<br/>Admin job moderation<br/>feature toggle, homepage display, status changes"]
    P24["2.4<br/>Superadmin policy takedown<br/>permanently remove a job and its applications"]

    D2["D2<br/>JobVacancy"]
    D16["D16<br/>QualificationTemplate"]
    D3["D3<br/>JobApplication"]
    D15["D15<br/>AuditLog"]
    D8["D8<br/>Notification"]

    A -->|"search query, location, salary range, category, page"| P21
    D2 -->|"read: active/open vacancies matching filters, homepage-featured jobs"| P21
    P21 -->|"job cards {title, employer, salary, location, applicationCount}, vacancy details"| A

    E -->|"create: title, description, salary, location, deadline, qualifications[]<br/>edit: vacancyId + changed fields<br/>close/archive/reopen: vacancyId"| P22
    D2 -->|"read: vacancy by id, ownership check (employer === req.user.id)"| P22
    P22 -->|"write: create/update JobVacancy {title, description, salary, qualifications, status, isActive}"| D2
    P22 -->|"write: create/update QualificationTemplate entries"| D16
    P22 -->|"write: notify applicants when a job closes"| D8
    P22 -->|"created / updated / closed / archived / reopened vacancy"| E

    L -->|"homepage feature toggle {jobId, isFeatured}; status update {jobId, status}"| P23
    D2 -->|"read: vacancy by id, current featured count/order"| P23
    P23 -->|"write: update JobVacancy {isFeatured, featuredOrder, status}"| D2
    P23 -->|"write: admin.job.featured_enabled/disabled, admin.job.status_updated event"| D15
    P23 -->|"write: notify employer that job was featured/closed/reopened"| D8
    P23 -->|"featured, active, closed, archived status"| E

    S -->|"takedown: jobId, policy-violation reason"| P24
    D2 -->|"read: vacancy by id"| P24
    P24 -->|"write: delete JobVacancy"| D2
    P24 -->|"write: delete all JobApplication rows for that vacancy"| D3
    P24 -->|"write: superadmin.job.policy_takedown event"| D15
    P24 -->|"write: notify employer their job was removed"| D8
    P24 -->|"removedApplications count, confirmation"| S
```

### 3.3 Process 3.0 — Job applications and status handling

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]

    P31["3.1<br/>Apply to vacancy<br/>resume, cover letter, application payload"]
    P32["3.2<br/>Track my applications<br/>list, update, delete, view status"]
    P33["3.3<br/>Review applicants<br/>view ranked and unranked applications, update status"]

    D3["D3<br/>JobApplication"]
    D2["D2<br/>JobVacancy"]
    D8["D8<br/>Notification"]
    D6["D6<br/>Conversation"]
    D7["D7<br/>Message"]
    D19["D19<br/>JobseekerDocument"]

    A -->|"vacancyId, resume file OR resumeDocumentId, coverLetterFile OR coverLetterDocumentId, coverLetter text"| P31
    D2 -->|"read: vacancy by id (exists, open)"| P31
    D3 -->|"read: existing application by (applicant, vacancy) — duplicate check"| P31
    D19 -->|"read: owned resume/cover-letter document by id, kind-scoped (only when no fresh file was uploaded for that slot)"| P31
    P31 -->|"write: create JobApplication {applicant, vacancy, resume, resumeDocumentId, coverLetter, coverLetterFile, coverLetterDocumentId, status: pending}"| D3
    P31 -->|"write: notify employer of new applicant"| D8
    P31 -->|"application created {message, application}"| A

    A -->|"applicationId, resume/coverLetter edits (file or saved library documentId), or withdraw request"| P32
    D3 -->|"read: applications where applicant = me, populated vacancy + employer"| P32
    D19 -->|"read: owned resume/cover-letter document by id, kind-scoped, when switching to a saved document"| P32
    P32 -->|"write: update JobApplication files/coverLetter/resumeDocumentId/coverLetterDocumentId, or delete on withdraw (storage borrowed from the library is left intact)"| D3
    P32 -->|"application list {vacancy, status: pending/reviewed/shortlisted/hired}"| A

    E -->|"jobId (view applicants); applicationId or applicationIds[] + status (shortlist / reject / hire) + employerNote"| P33
    D2 -->|"read: vacancy by id, ownership check"| P33
    D3 -->|"read: applications for vacancy or by applicationId(s)"| P33
    P33 -->|"write: update JobApplication.status (single or bulk), employerNote"| D3
    P33 -->|"write: notify applicant their status changed"| D8
    P33 -->|"write: auto-create Conversation between employer and applicant on first view"| D6
    P33 -->|"write: auto-send introductory Message"| D7
    P33 -->|"applicant list, updated status, updated/bulk-updated applications"| E
```

### 3.4 Process 4.0 — Recommendation and social engagement

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]

    P41["4.1<br/>Hybrid job search & ranking<br/>filtered browse + skills-based job scoring"]
    P44["4.4<br/>Ranked applicant matching<br/>semantic scoring of a job's applicants"]
    P42["4.2<br/>Follow / unfollow users<br/>social graph and connections"]
    P43["4.3<br/>Like / unlike jobs<br/>saved interest tracking"]

    D2["D2<br/>JobVacancy"]
    D9["D9<br/>Follow"]
    D10["D10<br/>JobLike"]
    D1["D1<br/>User"]
    D17["D17<br/>JobseekerProfile"]
    D3["D3<br/>JobApplication"]
    D8["D8<br/>Notification"]

    A -->|"industry, workNature, jobType, location, salary range, keyword q, page/limit"| P41
    D17 -->|"read: my skills, education, desired job title (for scoring)"| P41
    D2 -->|"read: active, non-archived vacancies matching filters"| P41
    P41 -->|"write: auto-close vacancies past their applicationDeadline"| D2
    P41 -->|"jobs[] with matchScore, total, hasSkills"| A

    E -->|"jobId, limit/skip"| P44
    D2 -->|"read: vacancy by id, ownership check"| P44
    D3 -->|"read: applications for vacancy, populated applicant"| P44
    D17 -->|"read: applicant NSRP profile fields (occupation, education, skills)"| P44
    P44 -->|"applicants[] ranked by semantic score, total"| E

    A -->|"target userId, follow / unfollow request"| P42
    D1 -->|"read: target user by id, role must be employer"| P42
    D9 -->|"read: existing follow edge (duplicate/unfollow check)"| P42
    P42 -->|"write: create/delete Follow {follower, following}"| D9
    P42 -->|"write: notify followed employer"| D8
    P42 -->|"follower/following counts, follow status"| A

    A -->|"jobId, like / unlike request"| P43
    D2 -->|"read: vacancy by id"| P43
    D10 -->|"read: existing like (duplicate/unlike check)"| P43
    P43 -->|"write: create/delete JobLike {user, job}"| D10
    P43 -->|"write: notify employer their job was liked"| D8
    P43 -->|"liked jobs, likeCount, isLiked"| A
```

### 3.5 Process 5.0 — Messaging and notifications

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]
    L["LMD-PESO Staff / Admin"]
    S["Superadmin"]

    P51["5.1<br/>Conversation management<br/>create, list, delete conversations; search users"]
    P52["5.2<br/>Message send / retrieval<br/>store message bodies and read flags"]
    P53["5.3<br/>Notification delivery<br/>create, list, mark read, unread count"]

    D6["D6<br/>Conversation"]
    D7["D7<br/>Message"]
    D8["D8<br/>Notification"]
    D1["D1<br/>User"]

    A -->|"create: participantId (must be employer) / list inbox / delete: conversationId / search: query text"| P51
    E -->|"create: participantId (must be resident) / list inbox / delete: conversationId / search: query text"| P51
    L -->|"create: participantId (resident, employer, admin, or superadmin) / list inbox / search: query text"| P51
    S -->|"create: participantId (must be admin) / list inbox / search: query text"| P51
    D1 -->|"read: target participant exists, role-pairing allowed (resident↔employer, admin↔anyone, superadmin↔admin only)"| P51
    D6 -->|"read: my conversations, sorted by lastMessageAt, with unread counts"| P51
    P51 -->|"write: create/delete Conversation {participants, lastMessage, lastMessageAt}"| D6
    P51 -->|"conversation object / conversation list / matching users[]"| A
    P51 -->|"conversation object / conversation list / matching users[]"| E
    P51 -->|"conversation object / conversation list / matching users[]"| L
    P51 -->|"conversation object / conversation list / matching users[]"| S

    A -->|"conversationId, message content"| P52
    E -->|"conversationId, message content"| P52
    L -->|"conversationId, message content"| P52
    S -->|"conversationId, message content"| P52
    D6 -->|"read: conversation by id, membership check"| P52
    D1 -->|"read: receiver still active/allowed"| P52
    P52 -->|"write: create Message {conversationId, sender, content, isRead: false}"| D7
    P52 -->|"write: update Conversation.lastMessage, lastMessageAt"| D6
    P52 -->|"write: notify the other participant (if not actively viewing the thread)"| D8
    D7 -->|"read: messages for conversationId, unread count"| P52
    P52 -->|"message list / created message, unread count (pushed live via Socket.IO)"| A
    P52 -->|"message list / created message, unread count (pushed live via Socket.IO)"| E

    A -->|"mark read: notificationId or mark-all; delete: notificationId; list request"| P53
    E -->|"mark read: notificationId or mark-all; delete: notificationId; list request"| P53
    L -->|"mark read: notificationId or mark-all; delete: notificationId; list request"| P53
    S -->|"mark read: notificationId or mark-all; delete: notificationId; list request"| P53
    D8 -->|"read: notifications for me, sorted by createdAt, unread count"| P53
    P53 -->|"write: update Notification.isRead / delete Notification"| D8
    P53 -->|"notification list {items, pagination}, unread count"| A
    P53 -->|"notification list {items, pagination}, unread count"| E
    P53 -->|"notification list {items, pagination}, unread count"| L
    P53 -->|"notification list {items, pagination}, unread count"| S
```

### 3.6 Process 6.0 — News and announcements

```mermaid
flowchart LR
    L["LMD-PESO Staff / Admin"]
    A["Applicant / Jobseeker"]
    E["Employer"]

    P61["6.1<br/>Publish / manage announcements<br/>news article create / edit / delete"]
    P62["6.2<br/>Comments<br/>post, list, moderate (delete) comments"]
    P63["6.3<br/>Like / unlike announcements<br/>saved interest tracking"]

    D5["D5<br/>Announcement"]
    D11["D11<br/>NewsLike"]
    D12["D12<br/>NewsComment"]
    D8["D8<br/>Notification"]
    D15["D15<br/>AuditLog"]

    L -->|"create/edit: title, content, category, image file, publishedAt, isActive, spesConfig / delete: newsId"| P61
    D5 -->|"read: announcement by id, list with filters"| P61
    P61 -->|"write: create/update/delete Announcement {title, content, category, imageUrl, spes}"| D5
    P61 -->|"write: admin.news.created/updated/deleted event"| D15
    P61 -->|"write: notify all residents/employers (or SPES followers) of new post"| D8
    P61 -->|"published/updated/deleted announcement"| L
    P61 -->|"published announcement feed {items, total}"| A
    P61 -->|"published announcement feed {items, total}"| E

    A -->|"newsId, comment text (1-1000 chars) / delete own comment: commentId"| P62
    E -->|"newsId, comment text / delete own comment: commentId"| P62
    L -->|"moderate: delete any commentId"| P62
    D5 -->|"read: announcement exists, commentsEnabled"| P62
    D12 -->|"read: visible comments for newsId, sorted by createdAt"| P62
    P62 -->|"write: create NewsComment {newsId, author, content} / hide or delete on moderation"| D12
    P62 -->|"write: notify announcement author of new comment; notify commenter if moderated"| D8
    P62 -->|"write: admin.news.comment_deleted event (moderator delete)"| D15
    P62 -->|"comment list, posted/deleted confirmation"| A
    P62 -->|"comment list, posted/deleted confirmation"| E
    P62 -->|"comment list, moderation confirmation"| L

    A -->|"newsId, like / unlike request"| P63
    E -->|"newsId, like / unlike request"| P63
    D5 -->|"read: announcement by id"| P63
    D11 -->|"read: existing like (duplicate/unlike check)"| P63
    P63 -->|"write: create/delete NewsLike {user, announcement}"| D11
    P63 -->|"write: notify announcement author their post was liked"| D8
    P63 -->|"likeCount, isLiked"| A
    P63 -->|"likeCount, isLiked"| E
```

### 3.7 Process 7.0 — SPES application lifecycle

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    L["LMD-PESO Staff / Admin"]

    P71["7.1<br/>Apply to SPES program<br/>validate deadline, NSRP completeness, documents"]
    P72["7.2<br/>View own application / results<br/>status, roster, published outcomes"]
    P73["7.3<br/>Admin evaluation<br/>record scores, amend result, release results"]

    D4["D4<br/>SpesApplication"]
    D5["D5<br/>Announcement"]
    D8["D8<br/>Notification"]
    D1["D1<br/>User"]
    D15["D15<br/>AuditLog"]

    A -->|"announcementId, contactNumber, school, gradeLevel, guardianName, supporting document files"| P71
    D5 -->|"read: SPES announcement by id, isActive, applicationDeadline"| P71
    D1 -->|"read: applicant role + NSRP onboarding-complete flag"| P71
    D4 -->|"read: existing application for (applicant, announcement) — duplicate check"| P71
    P71 -->|"write: create SpesApplication {applicant, announcement, contactNumber, school, gradeLevel, guardianName, documents, status: submitted}"| D4
    P71 -->|"write: notify admins of new application; confirm receipt to applicant"| D8
    P71 -->|"write: spes.application.submitted event"| D15
    P71 -->|"application submitted confirmation"| A

    A -->|"announcementId (my application) / results roster request"| P72
    D4 -->|"read: my application(s) by applicant, gated by resultsStatus"| P72
    D5 -->|"read: announcement.spes {resultsStatus, publishAcceptedList, resultsSummary}"| P72
    P72 -->|"application data (evaluation hidden until published) / published result roster"| A

    L -->|"list/filter queue; evaluationId + examScore, interviewScore, notes; amend: outcome; release: announcementId"| P73
    D4 -->|"read: applications by announcement/status, application by id"| P73
    D5 -->|"read: SPES announcement, resultsStatus not already published"| P73
    P73 -->|"write: update SpesApplication {evaluation, result.outcome, status}"| D4
    P73 -->|"write: update Announcement.spes.resultsStatus = published, resultsSummary"| D5
    P73 -->|"write: notify each applicant their result was released"| D8
    P73 -->|"write: spes.evaluation.recorded / spes.result.amended / spes.results.released event"| D15
    P73 -->|"saved evaluation, amended result, release summary {message, releasedCount}"| L
```

### 3.8 Process 8.0 — Moderation, compliance, and appeals

```mermaid
flowchart LR
    A["Applicant / Jobseeker"]
    E["Employer"]
    S["Superadmin"]
    L["LMD-PESO Staff / Admin"]

    P81["8.1<br/>Submit report<br/>report content, target type, target owner"]
    P82["8.2<br/>Review report queue<br/>triage open / under review / action taken (superadmin-only)"]
    P83["8.3<br/>Appeal review<br/>suspended user appeals; superadmin approves / denies"]
    P84["8.4<br/>Employer verification moderation<br/>approve or reject pending employer (admin-only)"]

    D13["D13<br/>Report"]
    D14["D14<br/>Appeal"]
    D1["D1<br/>User"]
    D15["D15<br/>AuditLog"]
    D8["D8<br/>Notification"]

    A -->|"targetType (user/job/news_post/news_comment/avatar/message), targetId, category, details"| P81
    E -->|"targetType, targetId, category, details"| P81
    D1 -->|"read: resolve target's owning user (job employer, comment/post author)"| P81
    D13 -->|"read: existing open report from me for the same target — duplicate check"| P81
    P81 -->|"write: create Report {reporter, targetType, targetId, targetOwner, category, details, status: open}"| D13
    P81 -->|"write: report.submitted event"| D15
    P81 -->|"report submitted, thanks message"| A
    P81 -->|"report submitted, thanks message"| E

    S -->|"queue filters (status, page); resolve: reportId + status, action (none/suspension/ban), note"| P82
    D13 -->|"read: reports by status, counts, populated reporter + targetOwner"| P82
    P82 -->|"write: update Report {status, resolution}"| D13
    P82 -->|"write: update User {isActive: false, accountStatus, suspensionReason} when action = suspension/ban"| D1
    P82 -->|"write: notify reporter of outcome; notify suspended/banned user"| D8
    P82 -->|"write: report.resolved event"| D15
    P82 -->|"reports queue {reports, total, openCount, counts} / resolution update"| S

    A -->|"appeal-only token, appeal message (10-2000 chars)"| P83
    E -->|"appeal-only token, appeal message (10-2000 chars)"| P83
    D1 -->|"read: my account isActive/accountStatus/suspensionReason"| P83
    D14 -->|"read: existing open appeal for me — duplicate check"| P83
    P83 -->|"write: create Appeal {user, message, status: pending}"| D14
    S -->|"queue filters; resolve: appealId + decision (approved/denied/under_review), adminResponse"| P83
    D14 -->|"read: appeals by status, counts"| P83
    P83 -->|"write: update Appeal {status, adminResponse, reviewedBy}"| D14
    P83 -->|"write: reactivate User {isActive: true, accountStatus: active} when approved"| D1
    P83 -->|"write: notify appellant of decision"| D8
    P83 -->|"write: appeal.submitted / appeal.resolved event"| D15
    P83 -->|"appeal submitted confirmation / approved / denied / under_review"| A
    P83 -->|"appeal submitted confirmation / approved / denied / under_review"| E
    P83 -->|"appeals queue {appeals, total, pendingCount, counts}"| S

    L -->|"queue filters; review: userId + verificationStatus (approved/rejected) + note"| P84
    D1 -->|"read: employers where verificationStatus = pending"| P84
    P84 -->|"write: update User {verificationStatus, verificationNote}"| D1
    P84 -->|"write: notify employer of decision"| D8
    P84 -->|"write: admin.user.verification_updated event"| D15
    P84 -->|"verificationStatus update"| E
```

### 3.9 Process 9.0 — Admin and superadmin oversight

```mermaid
flowchart LR
    S["Superadmin"]
    L["LMD-PESO Staff / Admin"]

    P91["9.1<br/>Provision staff accounts<br/>create admin, enable/disable, reset password"]
    P92["9.2<br/>Review role and user state<br/>read user details, update role, (de)activate, delete"]
    P93["9.3<br/>Audit and investigation<br/>dashboard analytics, audit log review"]

    D1["D1<br/>User"]
    D15["D15<br/>AuditLog"]
    D2["D2<br/>JobVacancy"]
    D3["D3<br/>JobApplication"]
    D8["D8<br/>Notification"]

    S -->|"create: name, email, staffNote / active: adminId + active flag / reset: adminId"| P91
    D1 -->|"read: admin accounts (name, email, staffNote, isActive, lastLoginAt)"| P91
    P91 -->|"write: create User {role: admin, mustChangePassword: true, staffNote} / update isActive / update password hash"| D1
    P91 -->|"write: superadmin.admin.created/enabled/disabled/password_reset event"| D15
    P91 -->|"admin roster, created admin + one-time tempPassword, enabled/disabled confirmation"| S

    L -->|"list/filter users, page; view userId detail"| P92
    S -->|"userId + role (resident/employer only, via admin path) / deactivate: userId + reason / reactivate: userId / delete: userId"| P92
    D1 -->|"read: users list with filters, user profile detail, role/ownership checks"| P92
    P92 -->|"write: update User {role} / {isActive: false, accountStatus, suspensionReason} / {isActive: true} / delete User"| D1
    P92 -->|"write: admin.user.role_updated / deactivated / reactivated / deleted event"| D15
    P92 -->|"write: notify user of role change or suspension"| D8
    P92 -->|"users list {users, total}, user profile detail {user, profile}, role/status update confirmation"| L
    P92 -->|"users list, user profile detail, role/status/delete confirmation"| S

    L -->|"analytics filters (year, municipality); job monitoring filters"| P93
    S -->|"audit log filters (actor, action, severity, page)"| P93
    D15 -->|"read: audit logs filtered/paginated, today's event count"| P93
    D1 -->|"read: account counts by role/status, signups this year"| P93
    D2 -->|"read: vacancy counts, homepage/featured jobs, admin job list"| P93
    D3 -->|"read: application counts, status breakdown"| P93
    P93 -->|"dashboard analytics {totals, breakdowns}, provincial analytics, job monitoring list/stats"| L
    P93 -->|"audit log entries {items, total}"| S
```

## 4) Current code-grounded notes: what is now out of date

The legacy documentation package in [README_DFD.md](README_DFD.md) is no longer aligned with the implemented system in the repo. It describes an older proposed design and references a smaller set of processes than what is actually present in the current codebase.

The repo now contains additional implemented modules that are not represented in the earlier design, including:

- SPES program management — [server/routes/spesRoutes.js](server/routes/spesRoutes.js)
- appeals and suspension review — [server/routes/appealRoutes.js](server/routes/appealRoutes.js)
- reports and moderation — [server/routes/reportRoutes.js](server/routes/reportRoutes.js)
- admin/superadmin oversight + audit logs — [server/routes/adminRoutes.js](server/routes/adminRoutes.js), [server/routes/superadminRoutes.js](server/routes/superadminRoutes.js)
- messaging and conversations — [server/routes/messageRoutes.js](server/routes/messageRoutes.js)
- notifications — [server/routes/notificationRoutes.js](server/routes/notificationRoutes.js)
- news announcements + comments + likes — [server/routes/newsRoutes.js](server/routes/newsRoutes.js), [server/routes/newsCommentRoutes.js](server/routes/newsCommentRoutes.js), [server/routes/newsLikeRoutes.js](server/routes/newsLikeRoutes.js)
- job likes and follows — [server/routes/jobLikeRoutes.js](server/routes/jobLikeRoutes.js), [server/routes/followRoutes.js](server/routes/followRoutes.js)
- recommendation flow — [server/routes/recommendationRoutes.js](server/routes/recommendationRoutes.js)
- verification queue — [server/routes/verificationRoutes.js](server/routes/verificationRoutes.js)
- jobseeker resume/cover-letter document library — [server/routes/jobseekerDocumentRoutes.js](server/routes/jobseekerDocumentRoutes.js), [server/controllers/jobseekerDocumentController.js](server/controllers/jobseekerDocumentController.js)

Their corresponding models are present in [server/models](server/models), including [server/models/SpesApplication.js](server/models/SpesApplication.js), [server/models/Appeal.js](server/models/Appeal.js), [server/models/Report.js](server/models/Report.js), [server/models/AuditLog.js](server/models/AuditLog.js), [server/models/Conversation.js](server/models/Conversation.js), [server/models/Message.js](server/models/Message.js), [server/models/Notification.js](server/models/Notification.js), [server/models/Announcement.js](server/models/Announcement.js), [server/models/JobLike.js](server/models/JobLike.js), [server/models/Follow.js](server/models/Follow.js), [server/models/NewsComment.js](server/models/NewsComment.js), and [server/models/JobseekerDocument.js](server/models/JobseekerDocument.js) (D19).

The resume/cover-letter builder is implemented client-side in [client/src/pages/ResumeStudio.jsx](client/src/pages/ResumeStudio.jsx) (template selection, section editing, PDF rendering via [client/src/utils/exportUtils.js](client/src/utils/exportUtils.js)) and [client/src/components/coverLetterBuilder.jsx](client/src/components/coverLetterBuilder.jsx) / [client/src/utils/coverLetterTemplates.js](client/src/utils/coverLetterTemplates.js); it has no dedicated server process of its own. A built document only touches the backend when the jobseeker saves it, at which point it is rendered to a PDF blob and posted through the same `/jobseeker/documents/upload` endpoint used for plain uploads (`source: "builder"` vs `"upload"` distinguishes the two, per [server/models/JobseekerDocument.js](server/models/JobseekerDocument.js)). The saved library is managed via [client/src/components/JobseekerDocumentsPanel.jsx](client/src/components/JobseekerDocumentsPanel.jsx) (surfaced on the jobseeker's profile page) and consumed at apply-time by [client/src/components/ApplyModal.jsx](client/src/components/ApplyModal.jsx), which lets an applicant pick a saved `resumeDocumentId`/`coverLetterDocumentId` instead of uploading a fresh file — this is process 1.4 in section 3.1 and the corresponding D19 reads added to process 3.0 in section 3.3.

The earlier DFD package therefore should be treated as legacy documentation, not as the current implemented-system DFD for this repo.

Section 3's exploded diagrams also fold in the employer-scoped surface at [server/routes/employerRoutes.js](server/routes/employerRoutes.js) / [server/controllers/employerController.js](server/controllers/employerController.js) — a parallel job-CRUD, applicant-review (`updateApplicationStatus`, `bulkUpdateApplicationStatuses`), qualification-template, and employer-stats API that duplicates part of `jobRoutes.js` under an `/employer` prefix and was not previously represented in this document. Every data-store arrow in section 3 was re-derived directly from each controller's Mongoose calls and `res.json(...)` payloads (including the shared `logAuditEvent` / `createNotificationForUser` / `notifyManyUsers` / `notifyLike` service calls), so a process now shows both what it reads from a store before acting and what it writes back, not just an unlabeled link.
