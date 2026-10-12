import { assertRateLimit, clientKey } from './rateLimit.js'

export async function assertClientErrorRateLimit(req) {
  await assertRateLimit({
    key: 'client-errors:global-daily',
    limit: 5000,
    windowMs: 24 * 60 * 60_000,
  })
  await assertRateLimit({
    key: `client-error:${clientKey(req)}`,
    limit: 20,
    windowMs: 10 * 60_000,
  })
}
