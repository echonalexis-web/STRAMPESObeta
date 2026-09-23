# STRAM-PESO — System Overview

*A plain-language explainer for presenting STRAM-PESO to the PESO Marinduque office.*

---

## 1. What is STRAM-PESO, in one sentence

STRAM-PESO is a website that connects **job seekers in Marinduque** with **local employers**, while giving the **PESO office** a dashboard to oversee everything — similar in spirit to how a job board like JobStreet or Facebook Jobs works, but built specifically for PESO Marinduque's needs, including the SPES student-employment program.

**Live links:**
- Website: https://strampeso.vercel.app/
- (Backend/API — technical, not meant for browsing): https://stram-peso.onrender.com

---

## 2. Who uses it — three kinds of accounts

| Account type | Who they are | What they can do |
|---|---|---|
| **Resident (Job Seeker)** | Marinduque residents looking for work, or students applying for SPES | Browse jobs, apply, build a resume, message employers, track applications |
| **Employer** | Local businesses/organizations offering jobs | Post job openings, review applicants, message candidates, update hiring status |
| **PESO Admin** | PESO Marinduque staff | Verify employers, moderate content, manage users, view analytics, run reports |

There's also a **Superadmin** level above Admin — a small number of trusted staff who can manage other admin accounts and handle the most sensitive actions (like restoring an accidentally-suspended account).

---

## 3. What problem this solves

Right now, matching job seekers with local employers, and running programs like SPES, typically happens through paperwork, walk-ins, and manual record-keeping. STRAM-PESO moves that online:

- Job seekers no longer need to physically visit PESO to browse open positions — they can search, filter, and apply from their phone.
- Employers get a self-service way to post openings and manage applicants instead of relying entirely on PESO staff to relay information.
- PESO staff get one dashboard to see everything happening on the platform — new job postings, applications, verification requests, and program applications — instead of tracking it across spreadsheets and paper forms.
- Every action is recorded (an **audit trail**), so there's accountability for who did what and when — useful for a government office that needs to be able to explain its decisions.

---

## 4. How a Job Seeker uses it (step by step)

1. **Sign up** with an email and password (or continue with Google).
2. **Verify their email** (a confirmation link is sent).
3. **Complete a short onboarding form** — basic info, address, ID numbers if relevant (SSS/GSIS, PhilHealth, Pag-IBIG, TIN), and a profile photo. This is the same information PESO would normally collect on paper.
4. **Browse the Job Board** — search by keyword, location, industry, or job type, similar to any job site.
5. **View a job's full details**, then **apply** with one click (their profile/resume is reused automatically).
6. **Build a resume** using a built-in resume tool if they don't already have one.
7. **Track their applications** — see whether an employer has viewed, shortlisted, interviewed, or declined them.
8. **Message employers directly** once there's a connection, similar to a chat app.
9. **Apply to SPES** (Special Program for Employment of Students) — a separate section for students applying to the government-subsidized summer/holiday work program, with its own announcements and results.
10. **Get notified** in real time — new messages, application status changes, and news from PESO all show up as notifications.

---

## 5. How an Employer uses it

1. **Register as an employer** and go through a similar onboarding — company details, industry, and documents (business permit, registration) for verification.
2. **Wait for PESO to verify** their account — this is a manual check PESO staff performs to confirm the business is legitimate before it can post jobs publicly.
3. **Post a job opening** — title, description, requirements, salary range, location, and how many openings.
4. **Review applicants** on an **Employer Dashboard**, which automatically ranks/sorts applicants to help spot the best matches faster.
5. **Update application status** — mark someone as shortlisted, interview-scheduled, hired, or not selected. The applicant sees this update in real time.
6. **Message applicants** directly to arrange interviews or ask follow-up questions.
7. **See stats** on their postings — how many people viewed, applied, etc.

---

## 6. How PESO Admin Staff use it

Admins get a control-room view of the whole platform:

- **User Management** — see every resident/employer account, change roles, suspend or reactivate accounts if there's abuse.
- **Employer Verification** — approve or reject a business's verification documents before they're allowed to post jobs.
- **Job Monitoring** — oversee all job postings on the platform, remove ones that violate policy.
- **SPES Applications** — manage the student employment program: post announcements, review applications, publish results.
- **Moderation Queue** — handle reports of inappropriate content or behavior.
- **News Feed Management** — publish PESO announcements/news directly to all users.
- **Audit Trail** — a searchable log of every significant action taken on the platform (who suspended which account, who approved which employer, etc.) — this exists specifically so PESO can answer "who did this and when" if ever questioned.
- **Reports & Analytics** — charts and numbers on platform activity: how many jobs posted, how many people got hired, trends over time, broken down by municipality.

---

## 7. Behind the scenes (in plain terms, no jargon)

Think of the system as having two halves that talk to each other:

- **The website you see** (the "frontend") — runs in the user's browser. It's what displays the job listings, forms, and buttons.
- **The engine room** (the "backend") — runs on a server, invisible to users. It stores all the data (in a database), checks that people are logged in before showing private information, and handles things like sending emails and processing uploaded files (resumes, IDs, permits).

When someone uploads a resume or ID, it's stored securely on the server (or in a third-party cloud storage service called Cloudinary, depending on configuration) rather than emailed around or kept on someone's personal computer.

The system also has a **real-time layer** (similar to how a chat app instantly shows a new message without refreshing the page) — this powers instant messaging and live notifications.

---

## 8. How data is kept safe — plain-language summary

Because the platform collects sensitive information (government ID numbers, addresses, resumes, business documents), a few protections are already built in:

- **Passwords are never stored as plain text** — they're scrambled (hashed) using industry-standard methods, so even PESO staff with database access can't see anyone's actual password.
- **Accounts require login** — most data can only be seen by someone who is logged in, and only the parts relevant to their role (a job seeker can't see another job seeker's private info; an employer can only see people who applied to their own jobs).
- **Every sensitive admin action is logged** in the Audit Trail — so there's a record of who approved, suspended, or changed anything.
- **File uploads are checked** for type and size before being accepted, to avoid unwanted or oversized files being stored.

As part of preparing this system for wider use, the development team has also run a full internal security and quality review of the codebase and identified a prioritized list of improvements — including tightening a few access controls around personal data and file storage — which are being addressed before the next release. This is a normal, expected part of hardening any system before it scales up to handle more users; it does not mean the system is unsafe to demo or pilot today, but it does mean PESO should expect an update cycle focused on these fixes.

---

## 9. What makes this different from a generic job board

- Built specifically around **PESO's workflow**: employer verification is a required, manual PESO approval step (not automatic, like most commercial job boards).
- Includes the **SPES program** as a first-class feature, not an afterthought — announcements, applications, and results all live in one place.
- Gives PESO staff **oversight tools** (audit trail, moderation, analytics) that a typical commercial job board would never expose to a government partner.
- Supports both **English and Filipino** language toggling for accessibility to more residents.

---

## 10. Current status

STRAM-PESO is a working, deployed capstone project (team: Ivy P. Cruzado, Alexis M. Echon, Alkimar S. Guitang, Jake Romar I. Sescar) — all core flows described above (registration, onboarding, job posting/applying, messaging, SPES applications, and the admin dashboard) are functional today on the live links above. It is presented here as a pilot/demo-ready system that the team is continuing to refine based on structured testing and review, with PESO Marinduque as its intended first real-world user.
