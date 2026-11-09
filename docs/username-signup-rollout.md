# Username sign-up: rollout checklist (rev 3)

This is the operator's guide for turning on username-only sign-up for jobseekers.
The developer did not run any migration, script, real database or real mail. Every
step below is yours to do, in this order.

Short version of the rule: **swap the indexes on a backup first, run the duplicate
check, then turn the flag on. Never turn the flag on before the index swap.**

## 0. What turning it on changes

- Jobseekers get a second way to sign up: username and password, no email.
- **An email is optional.** Nothing is blocked without one. A person with no email
  can apply (see the phone rule below), message, upload, apply to SPES, like,
  follow and report like anyone else. The age gates are unchanged.
- An email is recommended for two things: copies of notifications by email when
  away, and resetting your own password with a link. The app shows a dismissible
  prompt once after onboarding and a dismissible banner that returns after 14, 45
  and 90 days, then stops.
- **Backup codes** are offered by default right after a username-only sign-up
  (save, print, screenshot). They are shown once.
- **Protections that replace "limited access"** (all apply only while the flag is
  on, and all are per account, not per IP):
  - daily cap on job applications (default 20 per rolling 24 hours, counts
    withdrawn ones);
  - a valid phone number on file before a regular job application (format check
    only, no SMS). Existing jobseekers with no phone get an inline "add your phone"
    step in the apply screen, then continue. SPES is not affected;
  - light caps on starting conversations (default 20 per 24 hours) and on uploads
    (default 30 per 24 hours; SPES document uploads are not counted);
  - 3 backup-code generations per hour per account;
  - sign-up limits per IP (30 per hour, 200 per day), a hidden honeypot field and a
    signed form token;
  - lockout after 5 wrong passwords (jobseekers only);
  - employers can report an applicant account, and PESO admins review those reports.
- With the flag off, none of the new routes, fields, rules or caps is reachable
  for ordinary accounts. (Staff tools for accounts that already have no email stay
  available, see section 6.)

## 1. Environment variables

Server (names only here; never put a value in a document, ticket or commit):

| Variable | Needed | Notes |
|---|---|---|
| `USERNAME_SIGNUP_ENABLED` | yes | `true` turns the feature on. Leave unset or `false` until step 8. |
| `EMAIL_CODE_PEPPER` | when the flag is on | 32 or more random characters. The server refuses to start without it. Do not reuse `JWT_SECRET`. |
| `SIGNUP_LIMIT_PER_HOUR`, `SIGNUP_LIMIT_PER_DAY` | optional | Successful sign-ups per IP. Defaults 30 and 200. Raise for a venue where many people share one IP. |
| `JOB_APPLY_DAILY_CAP` | optional | Job applications per account per rolling 24 hours. Default 20. |
| `NEW_CONVERSATIONS_DAILY_CAP` | optional | Requests to start a conversation per account per 24-hour window. Default 20. |
| `UPLOADS_DAILY_CAP` | optional | Uploads per account per 24-hour window (documents, photo, profile files). Default 30. |
| `STAFF_RESET_HOURLY_CAP` | optional | Office password resets per staff member per hour. Default 20. Applies whether or not the flag is on. |
| `EMAIL_CODE_REQUEST_LIMIT_PER_HOUR_IP`, `EMAIL_CODE_VERIFY_LIMIT_PER_HOUR_IP` | optional | Defaults 60 and 120 per IP per hour. |
| `SIGNUP_TOKEN_LIMIT_PER_HOUR_IP`, `FORGOT_USERNAME_LIMIT_PER_HOUR_IP` | optional | Defaults 300 and 30. |
| `USERNAME_CHECK_LIMIT_PER_MIN` | optional | Username availability checks per IP per minute. Default 60. |

Invalid or non-positive values fall back to the default. The caps are counted in
MongoDB, so they hold across restarts and instances.

Client build: `VITE_USERNAME_SIGNUP_ENABLED=true` shows the sign-up toggle, the
"remember my username" box, the "forgot username" link and the phone option on the
PESO recovery request. Set it in the client build environment and rebuild. Keep it
in step with the server flag.

The code and username emails use the existing mail setup. If SMTP is not
configured, they are only logged to the server console, so nobody receives them.
Test mail delivery on staging.

## 2. Hosting (still open)

Tell the developer whether it runs on a single server, several instances, or
serverless. The limits live in the database, so they work either way. On serverless
the first request after a cold start also pays one database round trip per limiter.

## 3. Order of operations

Do these in order. Do not skip ahead.

1. **Back up the database.** Confirm you can restore it.
2. **Prepare a copy.** Restore the backup to a separate database. Steps 3 to 6 run
   against the copy, never against production.
3. **Dry run the index script on the copy.**
   `node server/scripts/swapUserEmailUsernameIndexes.js` with `MONGO_URI`
   pointing at the copy. It connects and counts, and changes nothing. Read the
   report (counts only). If it reports case-insensitive duplicate emails or
   usernames it stops: resolve those first (this is the duplicate check).
4. **Apply on the copy.** `node server/scripts/swapUserEmailUsernameIndexes.js --apply`.
   Then do the manual index checks in section 4.
5. **Walk the staging matrix** (section 5) against the copy with the new code and
   the flag **on**: `USERNAME_SIGNUP_ENABLED=true`, a pepper set, the client built
   with the flag on.
6. **Review what staging showed** (mail arrived, the limits felt right, the staff
   tools worked). Decide the open questions in section 8.
7. **Production, quiet window.** Deploy the new code with the flag **off**. The
   server creates one new index on first start (`JobApplication`: applicant and
   createdAt); on a large collection allow it a moment. Run the index script on
   production: dry run first, read it, then `--apply`. Between the index drops and
   the index creates there is no unique index on email and username, so do it when
   nobody is signing up. Verify that existing logins and Google sign-in still work.
8. **Turn the flag on** (server and client build). Check the first sign-ups by hand.
9. **Watch the first week** (section 7).

Why this order: with the flag on and the old indexes still in place, the second
email-less sign-up hits the old full unique index and fails with a server error.
The code reports that as a deployment fault in the server log, not as a user mistake.

## 4. Manual index checks (on the copy, after `--apply`)

The test suite cannot check index behavior because there is no in-memory MongoDB.
Check these by hand:

1. Two jobseeker accounts with no email both save. (They must coexist.)
2. Two accounts with the same email, differing only in letter case, collide.
3. Two accounts with no username both save.
4. Two accounts with the same username, differing only in letter case, collide.
5. An account saved with an empty-string email stores no email at all.
6. List the indexes: `email_unique_ci` and `username_unique_ci` exist, both
   partial and case-insensitive, and `email_1` is gone.
7. Existing accounts still sign in (email, username, Google).

## 5. Staging walk-through (flag on, no real mailbox for anyone but you)

Use accounts you created for this. Do not use a real person's account.

Sign-up and sign-in
- Register by username (15 years or older): you land on onboarding, signed in,
  with no email. A **backup-codes card** is on the first onboarding screen.
- Register with a date of birth under 15: blocked, nothing created.
- Weak, common, or username-containing password: refused with a clear reason.
  Username-only accounts need 10 or more characters.
- Register by email still works exactly as before (verification mail, no session).
- Google sign-in still works for a new and an existing Google account.
- Sign in with the username; sign in with an email.

Backup codes and the optional email
- Generate backup codes in the card. Download, print (the printout shows the codes
  only: no name, username or email), copy. The codes cannot be shown again. Confirm
  "I saved them" and Done. A fourth generation within an hour is refused for that
  account only; a second account on the same network is not affected.
- Finish onboarding: the **email prompt** appears once as a card, not a dialog.
  Dismiss it. The banner then appears on dashboard, jobs, SPES and profile.
  Dismissing the banner hides it for 14 days (check by setting the stored date back
  in the browser if you want to test the schedule); after the fourth dismissal it
  never returns. "Add email" always works from Settings and Edit Profile.
- **Nothing is blocked without an email:** with no email, apply to a job (after the
  phone step), start a conversation, upload a document and a photo, apply to SPES.
- Add an email with the wrong password: refused, and it counts toward the lockout.
  With the right password a 6-digit code arrives. Five wrong codes kill it. Asking
  again within 60 seconds is refused with a countdown. After a correct code the
  account is verified, other sessions are signed out, and you stay signed in.
- Ask for a code for an address that already belongs to another account: you get
  the same message as for a wrong code, and no accounts merge.

Protections
- Apply to a job with no phone on the account: an inline "add your phone" step
  appears in the apply screen. Enter a valid number, and the application continues.
  An invalid number is refused in the step. Set `JOB_APPLY_DAILY_CAP` to 2 and apply
  three times: the third is refused with the time left. SPES apply is not affected.
- Finishing onboarding without a phone is refused (flag on).
- Five wrong passwords lock the account for 15 minutes, then longer. The right
  password is refused too, with the same message.
- An in-app alert says the account is locked; a later sign-in after failures and a
  sign-in from a new browser raise their own alerts.

Staff (use an admin account and, separately, the superadmin)
- **Find account** (admin menu): search a jobseeker by name, username or email,
  open the profile.
- **Reset password at the counter** on the profile: needs the ID type shown, the
  "I checked the ID" box, a reason (10 characters or more) and the staff member's
  own password. A one-time temporary password is shown once. Sign in with it: you
  are forced to choose a new password, old backup codes no longer work, other
  sessions are signed out, and an in-app alert says PESO staff reset the password.
  The audit log records who, the ID type and the reason, never the password.
- **Unlock sign-in** on a locked account (needs a reason).
- **PESO recovery request with a phone contact** (flag on): on the public request
  form choose "By phone", submit. No email is sent. Staff and the account owner get
  an in-app alert. In the staff queue the request shows "Phone contact: complete in
  person"; **Complete in person** (ID type, ID checked, reason, staff password)
  performs the same reset. A phone request cannot be approved by link.
- **Reports:** as an employer, use "Report this applicant" on an applicant. As a
  PESO admin, open Reports: you see only reports about jobseeker accounts and can
  dismiss or record a warning. Suspend and ban are not offered. As the superadmin
  you see everything and can suspend or ban.

Other roles and screens
- Employer, admin and superadmin sign-in and screens are unchanged.
- Admin user list, profile and CSV show an email-less account by username.
- Employers see "No email on file" for an applicant, never a username.
- Repeat the core path for a jobseeker aged 15 to 17 (cannot apply to jobs, can
  apply to SPES, cannot start a conversation except with PESO staff) and 18 or
  older, in English and Filipino, at widths 1280, 768, 390 and 320.

## 6. What changes for existing accounts and flows (flag on)

- New password rules apply to register, change password, reset, set password and
  recovery set password: a short common-password list is refused, a password may
  not be or contain the username or the date of birth, and the special-character
  set is the same everywhere. Accounts with no email need 10 characters.
- Wrong passwords on change password, change email, recovery email and deactivate
  count toward the same per-account lockout as sign-in, for jobseekers.
- Sign-in answers one generic message for a wrong password and a locked account.
- Every jobseeker, with or without an email, is subject to the apply cap, the phone
  rule, the conversation and upload caps and the per-account backup-code limit.
  **Existing jobseekers with no phone** are asked for one when they apply (inline,
  not a hard block) and when they finish onboarding.
- The sign-in alert stores a coarse hash of browser and operating system only,
  never an IP, capped at 10 per account. Drop it if PESO objects.
- Registration checks the date of birth before looking up an email or username.
- **Staff tools and the flag.** The office password reset is reachable for any
  jobseeker while the flag is on, and for an account that has **no email** even
  with the flag off, so turning the flag off never strands those people. Reviewing
  reports and the report-applicant button do not depend on the flag.

## 7. Watching it (first week)

Admin, Users, Jobseekers tab (superadmin): the security summary shows counts only:
accounts with no email, accounts with no email and idle 90 days or more, lockouts
in the last 24 hours and 7 days, and accounts locked right now. Also watch the
audit log for `auth.password.reset_by_staff`, `auth.signup.rejected` and
`auth.account.locked`. Sudden growth in email-less accounts, rejected sign-ups or
lockouts is the signal to act. Quick response: turn the flag off (new email-less
sign-ups and the new caps stop at once).

The server log shows "Username sign-up hit the email unique index" if someone
signed up before the index swap. That means the order in section 3 was not followed.

## 8. Decisions and notices before the flag goes on

1. **Hosting** (section 2).
2. **Tell PESO:**
   - An email is optional. Nothing is blocked without one. The protections are the
     phone number, the daily caps, the reports and the lockout.
   - **Phone numbers are not verified** (no SMS). A plausible number is not proof of
     ownership.
   - People with no email who forget the password and have no backup codes need the
     **office reset** (ID checked in person) or a PESO recovery request with a phone
     contact. That is extra work for the office.
   - PESO admins review reports about jobseeker accounts; only the superadmin can
     suspend or ban.
   - **Undecided: who may message 15 to 17 year olds.** The code only stops a minor
     from starting a conversation with anyone except PESO staff. The rules for others
     starting a conversation with a minor were not reviewed. Needs a PESO decision.
3. **New-sign-in alert and device hash:** keep or drop.
4. **Remember my username** is off by default (shared computers). Confirm.
5. **Filipino wording:** every new Filipino string is a draft; have a native speaker
   review `fil.json` (the keys under `register`, `password`, `emailStep`,
   `emailPrompt`, `emailBanner`, `backupSignup`, `applyStep`, `recoveryPhone`,
   `report`, `login`, `forgot`, `forgotUsername`, `alerts`, `admin.accounts`,
   `admin.reset`, `admin.find`, the new `errors.codes` and `staffRecovery` additions).
6. **Mail wording:** the code and username emails are English only (server side).
7. **Unused old keys:** `emailBanner.applyBlocked`, `emailBanner.messageBlocked`,
   `emailBanner.uploadBlocked`, `emailBanner.message` and `errors.codes.EMAIL_REQUIRED`
   are left in the locale files, now unused. Approve their removal to clean up.

## 9. Open questions for PESO and the adviser (not answered by the code)

- Lawful basis and retention for accounts that never add an email (Data Privacy
  Act, RA 10173). Nothing is deleted automatically.
- Is a stored date of birth for an account with no email proportionate, and is
  guardian consent needed for 15 to 17 sign-ups?
- Does mailing a code to an address that did not consent need a notice?
- The phone number stored as a recovery contact and for applying: lawful basis,
  retention, and who may see it (staff and the employer the person applies to).
- Retention of recovery-request ID and selfie images for these users.
- The stored device hash for the new-sign-in alert.

## 10. Rollback

- **Fast:** set `USERNAME_SIGNUP_ENABLED=false` (server) and rebuild the client with
  `VITE_USERNAME_SIGNUP_ENABLED=false`. New email-less sign-ups stop, and the apply
  cap, phone rule and conversation and upload caps stop. Existing email-less
  accounts keep working and can still sign in.
- **Indexes are one-way once email-less accounts exist.** Recreating the old full
  unique email index fails while any account has no email. Before reverting the
  indexes, give those accounts an email (recovery) or remove them by an explicit
  decision. Say this to PESO before step 7.
- Keep the backup from step 1 until the first week passes without trouble.

## 11. Developer verification

Last run on this branch (no database, mocked mail): see the final report. Not run:
the app in a browser, real mail, a real database beyond your staging checks, index
behavior beyond the manual checks, screen readers, or Filipino review.
