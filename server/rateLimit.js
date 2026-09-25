import { getDb } from './db.js'

/**
 * Sliding-window login rate limit (Mongo-backed for Vercel).
 * @param {{ key: string, limit?: number, windowMs?: number }} opts
 */
export async function assertRateLimit({ key, limit = 10, windowMs = 15 * 60_000 }) {
  const db = await getDb()
  const col = db.collection('rate_limits')
  const now = Date.now()
  const _id = `rl:${key}`
  const doc = await col.findOne({ _id })

  if (!doc || now > doc.resetAt) {
    await col.updateOne(
      { _id },
      { $set: { count: 1, resetAt: now + windowMs } },
      { upsert: true },
    )
    return
  }

  if (doc.count >= limit) {
    const waitSec = Math.max(1, Math.ceil((doc.resetAt - now) / 1000))
    const err = new Error(`יותר מדי ניסיונות. נסו שוב בעוד ${waitSec} שניות`)
    err.status = 429
    err.retryAfterSec = waitSec
    throw err
  }

  await col.updateOne({ _id }, { $inc: { count: 1 } })
}

/** @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined>, socket?: { remoteAddress?: string } }} req */
export function clientKey(req) {
  const headers = req.headers || {}
  const xf = headers['x-forwarded-for']
  const forwarded = Array.isArray(xf) ? xf[0] : xf
  if (forwarded) return String(forwarded).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
