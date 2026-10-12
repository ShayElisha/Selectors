# Production hardening checklist — שיבוצון

## Environment (Vercel + local)

- Required for production:
  - `MONGODB_URI` — Atlas connection string for selectors, organizations, and accounts
  - `SESSION_SECRET` — unique random secret (32+ chars) for signing session tokens
  - `CRON_SECRET` — unique random secret for `/api/cron/load-rest`; Vercel Cron sends it in the `Authorization` header
  - `SUPER_ADMIN_PHONE` and `SUPER_ADMIN_PASSWORD` — super-admin credentials; use a dedicated phone and a strong password
  - `APP_URL` — exact public production origin (for example `https://app.example.com`); required for production CORS and email links
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — SMTP delivery for manager invitations, temporary passwords, password resets, and organization emails
- Required only when enabling the inspectors module:
  - `MONGODB_URI_INSPECTORS` — separate Atlas connection string for inspectors data
- Optional:
  - `PORT` — local API port; defaults to `3001`
  - `SMTP_FROM` — sender address; defaults to the authenticated SMTP mailbox
  - `SMTP_PASSWORD` — alias for `SMTP_PASS`
  - `MAIL_FROM` — alias for `SMTP_FROM`
  - `SUPER_ADMIN_EMAIL` — destination for super-admin notifications; defaults to `SMTP_USER`
  - `APP_NAME` — application name used in emails
  - `PUBLIC_APP_URL` — fallback public app origin if `APP_URL` is not set
  - `ADMIN_EMAIL` — optional default manager email for data reset
  - `BUG_REPORT_EMAIL` — destination for user bug reports
- `LOAD_REST_CRON=0` disables the local nightly scheduler; Vercel Cron remains protected by `CRON_SECRET`.
- Set production values in Vercel Project Settings → Environment Variables for every deployed environment. Never commit `.env`.

## Atlas network

Set `APP_URL` to the exact public site origin so the API CORS allowlist matches it.

1. Atlas → Network Access
2. Prefer a narrow IP allowlist (Vercel egress / office IPs) instead of `0.0.0.0/0`
3. Enable Atlas continuous backup / point-in-time restore for the cluster

## Monitoring

- `GET /api/health` returns `{ ok, db, at, service }` — wire to UptimeRobot / Better Stack / Vercel checks
- Watch Vercel function logs for `401` / `429` / `409` spikes

## API protections (built-in)

- Bearer token required for data / shifts / seed / audit
- Login rate-limit: 10 attempts / 15 minutes per IP+phone and per phone (Mongo `rate_limits`)
- Rate-limit rows expire at the end of their configured window; system error records are retained for 90 days with MongoDB TTL indexes
- Client error reports have a per-IP limit and a global cap of 5,000 reports per 24-hour window
- Manager account status is checked on each organization API request; inactive managers lose access immediately
- Cron authorization uses the `Authorization` header only
- CORS allows the configured app origin; production CSP permits Google Fonts and loads the early theme initializer as a same-origin script
- Seed requires body `{ "confirm": "RESET" }` plus auth
- Optimistic locking via `revision` — concurrent writes return `409`

## After deploy

1. Set all required values above in Vercel project env for Production and Preview
2. Redeploy
3. Log in once — old localStorage sessions without `token` must log in again

## Nightly load rest (02:00 Israel)

- Vercel Cron hits `GET /api/cron/load-rest` daily at `23:00 UTC` (~02:00 Israel daylight time)
- Local `npm run start:api` / `dev:api` also runs the same check around 02:00 Asia/Jerusalem
- Workers who had no real שיבוץ the previous Israel day get a −2 rest credit recorded; the tracking עומס already applies −2 per idle shift-family day from history (presence alone no longer blocks rest)
