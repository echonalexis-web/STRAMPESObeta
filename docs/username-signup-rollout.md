# Username sign-up: rollout checklist

This is the operator's guide for turning on username-only sign-up for jobseekers.
Nothing here was run by the developer: no migration, no script, no real database,
no real mail. Every step below is yours to do, in this order.

Short version of the rule: **swap the indexes on a backup first, run the duplicate
check, then turn the flag on. Never turn the flag on before the index swap.**

## 0. What turning it on changes

- Jobseekers get a second way to sign up: username and password, no email.
- A username-only account signs in straight away but has **limited access** until
  it adds and verifies an email with a 6-digit code.
- Without a verified email an account cannot: apply to regular job vacancies,
  message, upload general documents, or upload photos and files.
- It still can: browse jobs, **apply to SPES and upload SPES documents**, like,
  follow, report, edit text fields of its profile.
- New safeguards apply to accounts and passwords (see section 6). Some of them
  change existing flows for everyone, but only while the flag is on.
- With the flag off, none of the new routes, fields or rules is reachable.

## 1. Environment variables

Server (names only here; never put a value in a document, ticket or commit):

| Variable | Needed | Notes |
|---|---|---|
| `USERNAME_SIGNUP_ENABLED` | yes | `true` turns the feature on. Leave unset or `false` until step 8. |
| `EMAIL_CODE_PEPPER` | when the flag is on | 32 or more random characters. The server refuses to start without it. Do not reuse `JWT_SECRET`. Changing it later invalidates pending codes and unsent form tokens (harmless: people ask for a new code). |
| `SIGNUP_LIMIT_PER_HOUR`, `SIGNUP_LIMIT_PER_DAY` | optional | Successful sign-ups per IP. Defaults 30 and 200. Raise for a venue where many people share one IP. |
| `EMAIL_CODE_REQUEST_LIMIT_PER_HOUR_IP`, `EMAIL_CODE_VERIFY_LIMIT_PER_HOUR_IP` | optional | Defaults 60 and 120 per IP per hour. |
| `SIGNUP_TOKEN_LIMIT_PER_HOUR_IP`, `FORGOT_USERNAME_LIMIT_PER_HOUR_IP` | optional | Defaults 300 and 30. |
| `USERNAME_CHECK_LIMIT_PER_MIN` | optional | Username availability checks per IP per minute. Default 60. |

Client build: `VITE_USERNAME_SIGNUP_ENABLED=true` shows the sign-up toggle, the
"remember my username" box and the "forgot username" link. It must be set in the
client build environment and the client rebuilt. Keep it in step with the server
flag.

The code and username emails use the existing mail setup. If SMTP is not
configured, they are only logged to the server console, so nobody receives a code.
Test mail delivery on staging.

## 2. Hosting (still open)

The plan left "hosting" blank. The limits that matter are stored in the database,
so they work on a single server, several instances, or serverless. On serverless
the first request after a cold start also pays one database round trip per
limiter. Tell the developer which one you use so the notes can be corrected.

## 3. Order of operations

Do these in order. Do not skip ahead.

1. **Back up the database.** Confirm you can restore it.
2. **Prepare a copy.** Restore the backup to a separate database. All of steps 3 to
   6 run against the copy, never against production.
3. **Dry run the index script on the copy.**
   `node server/scripts/swapUserEmailUsernameIndexes.js` with `MONGO_URI`
   pointing at the copy. It connects and counts, and changes nothing. Read the
   report. It prints counts only, never emails or usernames. If it reports
   case-insensitive duplicate emails or usernames it stops: resolve those first
   (this is the duplicate check).
4. **Apply on the copy.** `node server/scripts/swapUserEmailUsernameIndexes.js --apply`.
   Then do the manual index checks in section 4.
5. **Walk the staging matrix** (section 5) against the copy with the new code and
   the flag **on**: `USERNAME_SIGNUP_ENABLED=true`, a pepper set, the client built
   with the flag on.
6. **Review what staging showed** (mail arrived, limits felt right, the gated
   actions behaved). Decide the open questions in section 8.
7. **Production, quiet window.** Deploy the new code with the flag **off**. Run the
   index script on production: dry run first, read it, then `--apply`. Between the
   index drops and the index creates there is no unique index on email and
   username, so do it when nobody is signing up. Verify that existing logins and
   Google sign-in still work.
8. **Turn the flag on** (server and client build). Check the first sign-ups by hand.
9. **Watch the first week** (section 7).

Why this order: with the flag on and the old indexes still in place, the second
email-less sign-up hits the old full unique index and fails with a server error.
The code reports that as a deployment fault in the server log, not as a user
mistake.

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
  with no email. The email prompt appears with "Skip for now".
- Register with a date of birth under 15: blocked, nothing created.
- Weak, common, or username-containing password: refused with a clear reason.
  Username-only accounts need 10 or more characters.
- Register by email still works exactly as before (verification mail, no session).
- Google sign-in still works for a new and an existing Google account.
- Sign in with the username; sign in with an email.

Add an email
- Skip, then use each limited action: apply to a job, send a message, upload a
  document, upload a photo. Each should be refused and open the email prompt.
- Apply to SPES and upload a SPES document: allowed.
- Add an email with the wrong password: refused, and it counts toward the lockout.
- Add an email with the right password: a 6-digit code arrives. Wrong code five
  times kills it. Asking again within 60 seconds is refused with a countdown.
  After a correct code the account is verified, other sessions are signed out, and
  you stay signed in.
- Ask for a code for an address that already belongs to another account: you get
  the same message as for a wrong code, and no accounts merge.

Lockout and recovery
- Five wrong passwords lock the account for 15 minutes. The right password is
  refused too, with the same message. Escalation: 30 then 60 minutes.
- An in-app alert says the account is locked. A later sign-in after failures
  raises the failed-attempts alert. A new browser raises the new sign-in alert.
- Unlock by password reset (account with a verified email), backup code, or an
  admin ("Unlock sign-in" on the user's profile, with a reason). The audit log
  records it.
- Generate backup codes without an email; redeem one by username.
- Forgot password with a username whose account has a verified email: the neutral
  message, and a reset link arrives. With no email: the neutral message, nothing
  arrives, and the page points to backup codes and the PESO office.
- Forgot username with a verified email: the username arrives by mail. With an
  unknown address: the same message, nothing sent.

Other roles and screens
- Employer, admin and superadmin sign-in and screens are unchanged.
- Admin user list, profile view and CSV show an email-less account by username.
- Employers see "No email on file" for an applicant, never a username.
- Repeat the core path for a jobseeker aged 15 to 17 (cannot apply to jobs, can
  apply to SPES) and 18 or older, in English and Filipino, at widths 1280, 768,
  390 and 320.

## 6. What changes for existing accounts and flows (flag on)

- New password rules apply to register, change password, reset, set password and
  recovery set password: a short common-password list is refused, a password may
  not be or contain the username or the date of birth, and the special-character
  set is the same everywhere (a superset of the old change-password set).
  Accounts with no email need 10 characters.
- Wrong passwords on change password, change email, recovery email and
  deactivate now count toward the same per-account lockout as sign-in, for
  jobseekers.
- Sign-in answers one generic message for a wrong password and a locked account.
- The sign-in alert stores a coarse hash of browser and operating system only,
  never an IP, capped at 10 per account. Drop this if PESO objects (it can be
  removed without affecting anything else).
- Registration checks the date of birth before looking up an email or username.
- An email-link sign-up for an email that is taken, plus an under-age date of
  birth, now reports the age error.

## 7. Watching it (first week)

Admin, Users, Jobseekers tab: the security summary shows counts only: accounts
with no email, accounts with no email and idle 90 days or more, lockouts in the
last 24 hours and 7 days, and accounts locked right now. Sudden growth in
"accounts with no email" or in lockouts is the signal to act. Quick response: turn
the flag off (new email-less sign-ups stop at once).

The server log shows "Username sign-up hit the email unique index" if someone
signed up before the index swap. That means the order in section 3 was not followed.

## 8. Decisions needed before the flag goes on

1. **Hosting** (section 2).
2. **Tell PESO** (these are product choices, not code defaults):
   - Email-less accounts have limited access, and the limits are enforced by the
     server.
   - **SPES apply and SPES document upload are not gated** on a verified email, by
     your decision, so a 15 to 17 year old with no email can use SPES. Result
     notices for them are in-app only.
   - Likes, follows and reports are open.
   - Usernames are semi-private: never shown to other users. Employers never see
     them. Admins do.
3. **New-sign-in alert and device hash:** keep or drop (see section 6).
4. **Remember my username** is off by default (shared computers). Confirm.
5. **Who handles a person with no email who forgot the password and has no backup
   codes?** They go through the existing PESO recovery request (ID and selfie,
   staff review). That is a support burden for the office.
6. **Filipino wording:** every new Filipino string is a draft. Have a native
   speaker review `fil.json` (the keys under `register`, `password`, `emailStep`,
   `emailBanner`, `login`, `forgot`, `forgotUsername`, `alerts`, `admin.accounts`,
   the new `errors.codes`, and the three rewritten settings strings).
7. **Mail wording:** the code email and username email are English only (server
   side).

## 9. Open questions for PESO and the adviser (not answered by the code)

- Lawful basis and retention for accounts that never add an email (Data Privacy
  Act, RA 10173). Nothing is deleted automatically; the admin summary only counts
  accounts idle 90 days or more.
- Is a stored date of birth for an account with no contact channel proportionate,
  and is guardian consent needed for 15 to 17 sign-ups?
- Does mailing a code to an address that did not consent need a notice? A cap of
  3 codes per address per day limits abuse.
- What do we tell a person with no email about recovery, and who owns that support?
- Retention of recovery-request ID and selfie images for these users.
- The stored device hash for the new-sign-in alert (section 6).

## 10. Rollback

- **Fast:** set `USERNAME_SIGNUP_ENABLED=false` (server) and rebuild the client with
  `VITE_USERNAME_SIGNUP_ENABLED=false`. New email-less sign-ups stop. Existing
  email-less accounts keep working but lose the add-email and lockout behavior;
  their gated actions stay blocked, and they can still sign in.
- **Indexes are one-way once email-less accounts exist.** Recreating the old full
  unique email index fails while any account has no email. Before reverting the
  indexes, give those accounts an email (through the recovery request process) or
  remove them by an explicit decision. Say this to PESO before step 7.
- Keep the backup from step 1 until the first week passes without trouble.

## 11. Developer verification

Last run on this branch (server and client, no database, mocked mail):
server Jest 56 suites, 948 tests passing; client `npm test` 360 passing;
`npm run lint` unchanged at the 47-problem baseline; `npm run build` succeeds.
Not run: the app in a browser, real mail, a real database, index behavior,
screen readers, or Filipino review.
