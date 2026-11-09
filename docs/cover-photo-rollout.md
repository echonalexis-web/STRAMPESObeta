# Cover photos, profile viewing rules and hover cards: rollout

Branch: `feat/cover-photo-profile-views`. The plan is `COVER_PHOTO_PLAN.md`.
This page is what you do to ship it and how to check it. Nothing here has been
run against a real database or Cloudinary.

## What ships, in the order it was built

| Phase | What | Contract change? |
|---|---|---|
| 0a to 0e | Over-sharing fixes behind one projection helper (`server/services/profileProjection.js`) | Yes, fields removed (below) |
| 1 | `BannerTemplate`, resolved cover, shared `ProfileBanner`, superadmin Banner templates screen | New fields only |
| 2 | `PUT /auth/profile/cover` (template id only) and the picker | New |
| 3 | Employer image upload, moderation, cleanup | New |
| 4, 5 | `GET /profiles/:id/summary`, `GET /profiles/:id`, hover card, `/people/:id` | New |
| 5b | Share my contact details, `JobApplication.includePhoto` | New |

## Deploy order

1. Deploy the server. No data migration is needed: accounts with no `cover`
   render the built-in "Classic green", which is exactly the old look.
2. Indexes build themselves on start (`BannerTemplate` unique default, `ContactShare`,
   `users.cover.templateId`). They are small.
3. Optional: seed the starter templates. Dry run is the default and prints counts only:

   ```text
   node server/scripts/seedBannerTemplates.js            # report
   node server/scripts/seedBannerTemplates.js --apply    # write the missing ones
   ```

   Without the seed everyone still sees Classic green and the picker says no covers are available.
4. Deploy the client.
5. Local storage only (no Cloudinary): `/uploads/covers/` is served publicly
   (an `img` tag cannot send a token). Nothing else under `/uploads` changed.

## Environment variables (all optional)

| Name | Default | What |
|---|---|---|
| `COVER_UPLOADS_DAILY_CAP` | 10 | Employer cover uploads per account per 24 h |
| `PROFILE_VIEWS_DAILY_CAP` | 1500 | Profile views per account per 24 h (anti-scraping) |
| `PROFILE_VIEWS_PER_MINUTE` | 60 | In-memory burst limit per account (resets on restart) |

`DISABLE_RATE_LIMITS=true` turns them off, as for the other limiters.

## Contract changes (Phase 0, existing endpoints)

| Endpoint | Removed |
|---|---|
| `GET /employer/jobseekers/:userId` | Everything outside a whitelist: government ID number and OCR text, login lock, tokens, recovery data, staff notes, NSRP numbers, exact address. Phone and email only for an applicant, never a follower |
| Applicant lists (`/employer/jobs/:jobId/applicants`, status update, bulk status, ranked applicants) | `resume`, `resumeFile`, `validIdFile` from the account, the merged `JobseekerProfile`, exact address (now "Municipality, Province"). A hidden-profile applicant shows name and contact only |
| `/jobs`, `/jobs/:id`, `/jobs/homepage` | Employer `email` and `phone` for signed-out callers (always for `/homepage`); employer TIN, fax, owner and contact-person fields for everyone but the employer and staff |
| News list and detail | Author `email` |
| `GET /messages/users/search` | `email` in results and matching, except for staff. Employers no longer find hidden profiles, 15 to 17 year olds or unknown-age accounts |
| `POST /messages/conversations` | Employer to a 15 to 17 year old: `403 MESSAGING_MINOR_RESTRICTED` |
| `GET /follows/:userId/followers` and `/following` | Owner and staff only: others get `403 FOLLOW_LIST_PRIVATE`. Counts stay on `/follow-status` |
| Owner-side `/users/*` profile reads | `backupCodes`, `recoveryEmailToken`, OCR raw text |

Client: the employer view of an applicant no longer calls the follower lists and no
longer shows demographics, government IDs or a resume section.

## Roll back

Each phase is its own commit. The new fields are additive, so reverting the client
and server leaves stored `cover`, `ContactShare` and `includePhoto` data unused and harmless.
Reverting Phase 0 restores the old over-sharing and should not be done without a reason.

## Manual checks

1. Superadmin: open the console, add a template, set a default, archive one in use
   (the confirm names the count), reorder with the buttons, try to delete one in use.
2. Jobseeker: Edit cover on My Profile, pick a template, reset to default. The page
   looks unchanged with no choice made. Try the API with `{ "templateId": "...", "image": "x" }`: refused.
3. Verified employer: Upload your own, crop at 4:1, check the phone and desktop
   preview, upload, replace, remove. An unverified employer sees the explanation.
4. PESO admin: `POST /admin/users/:id/cover/remove` twice for one employer: the second
   revokes the upload right; `restore-upload` restores it. Both need a reason.
5. Hover a commenter's name on a news article on a desktop browser: card after about
   0.4 s, no card on a phone, Escape closes, tabbing to the name opens it.
6. Employer opens `/people/:id` for an applicant with a hidden profile: name and the
   application data only. With "Include my photo" ticked the avatar appears, never the cover.
7. Jobseeker: Share my contact details in a conversation with an employer. Tick only the
   phone. As the employer open the person: only the phone shows. Stop sharing: it goes at once.
8. Widths 1280, 768, 390 and 320, English and Filipino. The Filipino text is a draft
   for a native speaker to review.

## Open questions

- **PESO:** may an employer ever see or contact a 15 to 17 year old, and under what
  supervision? Until PESO answers, employers cannot see, search or contact them in the
  portal and PESO staff handle SPES placements.
- Retention of replaced or removed cover files and the Data Privacy Act questions in
  section 9 of the plan.

## Not done in this branch

- The hover card is applied to news comments only. Followers lists, applicant tables,
  Messages and job cards (plan section 18.1) can adopt `ProfileLink` one by one.
- Admin user view does not yet show the cover thumbnail or buttons for removal; the
  endpoints exist and are tested.
- Admin account deletion removes the cover files only. Avatar and document cleanup on
  deletion is a separate pre-existing gap.
- The old `/employer/applicants/:userId` page keeps its own layout; `/people/:id` is
  the new read-only page for every role.
