import { createHash } from 'node:crypto'
import { getDb } from './db.js'

let indexPromise

async function ensureRateLimitIndexes(collection) {
  if (!indexPromise) {
    indexPromise = (async () => {
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      await collection.updateMany(
        { expiresAt: { $exists: false }, resetAt: { $exists: true } },
        [{ $set: { expiresAt: { $toDate: '$resetAt' } } }],
      )
    })().catch((error) => {
      indexPromise = null
      throw error
    })
  }
  await indexPromise
}

/**
 * Sliding-window rate limit (Mongo-backed for Vercel).
 * Progressive backoff: after half the budget, wait grows with attempt count.
 * @param {{ key: string, limit?: number, windowMs?: number }} opts
 */
export async function assertRateLimit({ key, limit = 10, windowMs = 15 * 60_000 }) {
  const db = await getDb()
  const col = db.collection('rate_limits')
  await ensureRateLimitIndexes(col)
  const now = Date.now()
  const _id = `rl:${createHash('sha256').update(key).digest('hex')}`
  const resetWindow = { $lte: [{ $ifNull: ['$resetAt', 0] }, now] }
  const doc = await col.findOneAndUpdate(
    { _id },
    [
      {
        $set: {
          count: {
            $cond: [
              resetWindow,
              1,
              { $add: [{ $ifNull: ['$count', 0] }, 1] },
            ],
          },
          resetAt: { $cond: [resetWindow, now + windowMs, '$resetAt'] },
          expiresAt: {
            $toDate: { $cond: [resetWindow, now + windowMs, '$resetAt'] },
          },
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  )

  if (doc.count > limit) {
    const over = doc.count - limit
    const progressive = Math.min(120, 5 + over * 5)
    const waitSec = Math.max(
      progressive,
      Math.ceil((doc.resetAt - now) / 1000),
    )
    const err = new Error(`יותר מדי ניסיונות. נסו שוב בעוד ${waitSec} שניות`)
    err.status = 429
    err.retryAfterSec = waitSec
    throw err
  }
}

/** Clear counters after a successful login so legit users are not trapped. */
export async function clearRateLimit(key) {
  const db = await getDb()
  const col = db.collection('rate_limits')
  const _id = `rl:${createHash('sha256').update(key).digest('hex')}`
  await col.deleteOne({ _id })
}

/** @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined>, socket?: { remoteAddress?: string } }} req */
export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}
