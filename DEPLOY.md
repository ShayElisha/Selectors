# Production hardening checklist — שיבוצון

## Environment (Vercel + local)

- Required for production:
  - `MONGODB_URI` — Atlas connection string for selectors, organizations, and accounts
  - `SESSION_SECRET` — unique random secret (32+ chars) for signing session tokens
  - `PII_ENCRYPTION_KEYS` — JSON object of key IDs to independent random secrets (each 32+ chars), for example `{"2026-01":"<random-secret>"}`; the active key ID is set by `PII_ENCRYPTION_ACTIVE_KEY_ID`
  - `CRON_SECRET` — unique random secret for `/api/cron/load-rest`; Vercel Cron sends it in the `Authorization` header
  - `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_PASSWORD`, and `SUPER_ADMIN_EMAIL` — super-admin credentials and destination for its sign-in verification codes; use a dedicated phone and a strong password
  - `APP_URL` — exact public production origin (for example `https://app.example.com`); required for production CORS and email links
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — SMTP delivery for sign-in verification codes, manager invitations, temporary passwords, password resets, and organization emails
- Required only when enabling the inspectors module:
  - `MONGODB_URI_INSPECTORS` — separate Atlas connection string for inspectors data
- Required only when enabling the security (מאבטחים) module:
  - `MONGODB_URI_SECURITY` — separate Atlas connection string for security/guards data (same schema as selectors: workers, lanes, shifts, …)
- Optional:
  - `PORT` — local API port; defaults to `3001`
  - `SMTP_FROM` — sender address; defaults to the authenticated SMTP mailbox
  - `SMTP_PASSWORD` — alias for `SMTP_PASS`
  - `MAIL_FROM` — alias for `SMTP_FROM`
  - `APP_NAME` — application name used in emails
  - `PUBLIC_APP_URL` — fallback public app origin if `APP_URL` is not set
  - `ADMIN_EMAIL` — optional default manager email for data reset
  - `BUG_REPORT_EMAIL` — destination for user bug reports
- `LOAD_REST_CRON=0` disables the local nightly scheduler; Vercel Cron remains protected by `CRON_SECRET`.
- Set production values in Vercel Project Settings → Environment Variables for every deployed environment. Never commit `.env`.
- The server refuses to start in production unless a valid PII encryption key is configured. Do not deploy the code change before setting the key.
- Email verification is mandatory; there is no emergency bypass. A broken SMTP service or missing/invalid account email prevents login.
- Before deployment, run `npm run mail:test -- <SUPER_ADMIN_EMAIL>` with the production SMTP settings and confirm delivery. Ensure every active manager account has a valid, accessible email address.

## Atlas network

Set `APP_URL` to the exact public site origin so the API CORS allowlist matches it.

1. Atlas → Network Access
2. Prefer a narrow IP allowlist (Vercel egress / office IPs) instead of `0.0.0.0/0`
3. Enable Atlas continuous backup / point-in-time restore for the cluster

## PII encryption migration and key rotation

Worker email, phone, and manager notes are encrypted at rest using AES-256-GCM. Lookup hashes are deterministic HMACs; they are not reversible. Audit records omit contact details.

1. Before enabling the new release, take and verify an Atlas backup.
2. Set `PII_ENCRYPTION_KEYS` to a JSON object with a random 32+ character secret and set `PII_ENCRYPTION_ACTIVE_KEY_ID` to its key ID. Generate secrets with a cryptographically secure password manager or secret generator; never commit them.
3. If the database contains legacy `enc:v1:` values, retain the previous value in `PII_ENCRYPTION_KEY` during migration so the script can decrypt them. Keep all existing v2 key IDs in `PII_ENCRYPTION_KEYS`.
4. Run `npm run migrate:pii` once in dry-run mode and review only the per-database counts. Then run `npm run migrate:pii -- --apply` against the intended database environment.
5. Verify the migration counts and application reads, then deploy. The migration is idempotent and can be rerun after restoring a backup.
6. To rotate: add the new key alongside the old key, set `PII_ENCRYPTION_ACTIVE_KEY_ID` to the new ID, deploy, run the migration with `--apply`, verify records can be read, and only then remove the old key. Keep the old key available until verification and backup-retention windows have passed.
7. Keep a separately secured offline backup of every key needed by retained database backups. Losing an encryption key makes its ciphertext unrecoverable.

Do not remove `PII_ENCRYPTION_KEY` while any legacy `enc:v1:` values or backups still require it.

## Monitoring

- `GET /api/health` returns `{ ok, db, at, service }` — wire to UptimeRobot / Better Stack / Vercel checks
- Watch Vercel function logs for `401` / `429` / `409` spikes

## API protections (built-in)

- Bearer token required for data / shifts / seed / audit
- Login rate-limit: 10 attempts / 15 minutes per IP+phone and per phone (Mongo `rate_limits`)
- Every successful password login requires a single-use email code, valid for 10 minutes and limited to 5 attempts
- Rate-limit rows expire at the end of their configured window; system error records are retained for 90 days with MongoDB TTL indexes
- Client error reports have a per-IP limit and a global cap of 5,000 reports per 24-hour window
- Manager account status is checked on each organization API request; inactive managers lose access immediately
- Cron authorization uses the `Authorization` header only
- CORS allows the configured app origin; production CSP permits Google Fonts and loads the early theme initializer as a same-origin script
- Seed requires body `{ "confirm": "RESET" }` plus auth
- Optimistic locking via `revision` — concurrent writes return `409`

## After deploy

1. Set all required values above in Vercel project env for Production and Preview, including the super-admin email and SMTP settings for verification codes
2. Redeploy
3. Confirm the super-admin can sign in and receive the code at `SUPER_ADMIN_EMAIL`; then send a test with the authenticated `/api/mail-test` endpoint
4. Existing sessions issued before email verification was enabled must log in again

## Nightly load rest (02:00 Israel)

- Vercel Cron hits `GET /api/cron/load-rest` daily at `23:00 UTC` (~02:00 Israel daylight time)
- Local `npm run start:api` / `dev:api` also runs the same check around 02:00 Asia/Jerusalem
- The same cron pass retries durable background jobs. Jobs are also kicked immediately after being written; Hobby's daily cron is the recovery path for failed attempts. On Pro, add a five-minute `/api/cron/background-jobs` cron for faster retries.
- Workers who had no real שיבוץ the previous Israel day get a −2 rest credit recorded; the tracking עומס already applies −2 per idle shift-family day from history (presence alone no longer blocks rest)

## Shift reminders

- Local API runs `/api/cron/shift-reminders` about every minute while `start:api` / `dev:api` is up
- Vercel Hobby only allows daily crons, so the every-5-minutes schedule is not in `vercel.json` (would fail the deploy). On Pro you can add `"schedule": "*/5 * * * *"` for `/api/cron/shift-reminders` again
