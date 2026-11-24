# Sample data for STRAM-PESO

Generates 10 verified employers across Marinduque, about 45 job vacancies, 100 jobseekers with their own
logins, and about 400 applications. Use it on a **disposable** database only.

Files: `generator.js` (pure, no I/O), `seedSample.js` (writer), `cleanupSample.js`, `guards.js`.

## Dry run (default, writes nothing)

```
cd server
npm run seed:sample
npm run seed:sample -- --seed 7 --employers 10 --jobseekers 100
```

Prints counts per town, per status, sample rows and the paths that would be used.

## Write to a disposable local database

Point the script at the database yourself. It never reads `server/.env`.

```
set SEED_MONGO_URI=mongodb://127.0.0.1:27017/strampeso_seed_dev      (PowerShell: $env:SEED_MONGO_URI="...")
npm run seed:sample -- --apply
```

Flags: `--employers 10`, `--jobseekers 100`, `--seed <n>` (same seed, same data), `--batch <label>` (default: timestamp),
`--force-new-batch`, `--mongo-uri <uri>`.

Default town allocation for 10 employers: Boac 3, Santa Cruz 2, Gasan 2, Mogpog 1, Buenavista 1, Torrijos 1.
Other totals are split by approximate population, at least one per town from 6 up.

Running the same `--seed` twice under two batches creates the same usernames and emails, so the second run refuses.
Use another `--seed`, or clean up the first batch.

## Where the credentials are

`server/scripts/seed/output/credentials-<batch>.csv` (columns: role, username, email, password, account_type),
created with file mode 600. This is the only place plaintext passwords exist. They are never printed or put in the manifest.
Employers sign in with their email. Jobseekers sign in with their username (protected jobseekers also have a verified email).
The `output/` folder is git-ignored. On Windows the mode 600 is not enforced by the filesystem; keep the folder private.

## Clean up

```
npm run seed:cleanup -- --batch <label>            (dry run)
npm run seed:cleanup -- --batch <label> --apply
```

Deletes only documents listed in `output/manifest-<batch>.json` that still match the markers:
email `@seed.stram.example` or username `seed_...` for users, and ownership by those users for everything else.
A seed job that has an application from outside the manifest is kept and reported.
Data other code created about seed users (audit log entries, notifications, messages) is not in the manifest and is not removed.

## Safety guards

- Refuses if `NODE_ENV=production`.
- Refuses unless every host is localhost/127.0.0.1/::1, or the database name ends with `_dev` or `_test`.
- Prints the target (credentials masked) before writing; re-checks the host and database the driver really connected to.
- Refuses if a manifest for the batch already exists, unless `--force-new-batch` (then a new batch label is used).
- Refuses if any planned email or username already exists.
- No mail, notification or socket code is loaded; the writer only inserts documents. No network calls besides the database.
- Seed fields are not added to the production models. Documents are marked only by the reserved email domain and `seed_` prefix.

## What is generated, and what is not

- Employers: `verificationStatus: "verified"` with reviewed date, email verified, account active. `verificationReviewedBy` is an
  existing admin found in the database (read-only lookup), or empty if there is none. Document fields hold the placeholder
  `seed-placeholder://no-file`; no files exist.
- Jobs: status mix through the app's real fields. Open = `status: "active"`; Closed = `status: "closed"`; Archived = `status: "closed"`
  with `archived: true` and an `archivedMetrics` snapshot. No drafts.
- Applications: statuses `pending`, `under_review`, `shortlisted`, `hired`, `rejected` (the app's names; "Reviewed" is `under_review`).
  Dates and hire fields come from the app's own `setApplicationStatus`.
- The application model has no match-score field, so no match scores are stored.
- Phones use the reserved fake pattern `+63 900 000 NNNN`. It passes the app's phone format check but is not a real number.
