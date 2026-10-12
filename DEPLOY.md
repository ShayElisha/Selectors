# Production hardening checklist — שיבוצון

## Environment (Vercel + local)

- `MONGODB_URI` — Atlas connection string
- `SESSION_SECRET` — long random secret (32+ chars) for signing Bearer tokens
- `CRON_SECRET` — shared secret for `/api/cron/load-rest` (Vercel Cron sends it as `Authorization: Bearer …`)
- Never commit `.env`

## Atlas network

Set `APP_URL` to the exact public site origin so the API CORS allowlist matches it.

1. Atlas → Network Access
2. Prefer IP allowlist (Vercel egress / office IPs) instead of `0.0.0.0/0`
3. Enable Atlas continuous backup / point-in-time restore for the cluster

## Monitoring

- `GET /api/health` returns `{ ok, db, at, service }` — wire to UptimeRobot / Better Stack / Vercel checks
- Watch Vercel function logs for `401` / `429` / `409` spikes

## API protections (built-in)

- Bearer session token required for data / shifts / seed / audit
- Login rate-limit: 10 attempts / 15 minutes per IP+phone and per phone (Mongo `rate_limits`)
- Manager account status is checked on each organization API request; inactive managers lose access immediately
- Cron authorization uses the `Authorization: Bearer <CRON_SECRET>` header only
- CORS allows the configured app origin; production CSP permits Google Fonts and loads the early theme initializer as a same-origin script
- Seed requires body `{ "confirm": "RESET" }` plus auth
- Optimistic locking via `revision` — concurrent writes return `409`

## After deploy

1. Set `SESSION_SECRET` and `CRON_SECRET` in Vercel project env (Production + Preview)
2. Redeploy
3. Log in once — old localStorage sessions without `token` must log in again

## Nightly load rest (02:00 Israel)

- Vercel Cron hits `GET /api/cron/load-rest` daily at `23:00 UTC` (~02:00 Israel daylight time)
- Local `npm run start:api` / `dev:api` also runs the same check around 02:00 Asia/Jerusalem
- Workers who had no real שיבוץ the previous Israel day get a −2 rest credit recorded; the tracking עומס already applies −2 per idle shift-family day from history (presence alone no longer blocks rest)
