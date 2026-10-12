import { createHash } from 'node:crypto'
import { getDb } from './db.js'

/**
 * Sliding-window login rate limit (Mongo-backed for Vercel).
 * @param {{ key: string, limit?: number, windowMs?: number }} opts
 */
export async function assertRateLimit({ key, limit = 10, windowMs = 15 * 60_000 }) {
  const db = await getDb()
  const col = db.collection('rate_limits')
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
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  )

  if (doc.count > limit) {
    const waitSec = Math.max(1, Math.ceil((doc.resetAt - now) / 1000))
    const err = new Error(`יותר מדי ניסיונות. נסו שוב בעוד ${waitSec} שניות`)
    err.status = 429
    err.retryAfterSec = waitSec
    throw err
  }
}

/** @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined>, socket?: { remoteAddress?: string } }} req */
export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}
