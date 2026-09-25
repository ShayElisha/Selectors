# Production hardening checklist — שיבוצון

## Environment (Vercel + local)

- `MONGODB_URI` — Atlas connection string
- `SESSION_SECRET` — long random secret (32+ chars) for signing Bearer tokens
- Never commit `.env`

## Atlas network

1. Atlas → Network Access
2. Prefer IP allowlist (Vercel egress / office IPs) instead of `0.0.0.0/0`
3. Enable Atlas continuous backup / point-in-time restore for the cluster

## Monitoring

- `GET /api/health` returns `{ ok, db, at, service }` — wire to UptimeRobot / Better Stack / Vercel checks
- Watch Vercel function logs for `401` / `429` / `409` spikes

## API protections (built-in)

- Bearer session token required for data / shifts / seed / audit
- Login rate-limit: 10 attempts / 15 minutes per IP+phone (Mongo `rate_limits`)
- Seed requires body `{ "confirm": "RESET" }` plus auth
- Optimistic locking via `revision` — concurrent writes return `409`

## After deploy

1. Set `SESSION_SECRET` in Vercel project env (Production + Preview)
2. Redeploy
3. Log in once — old localStorage sessions without `token` must log in again
