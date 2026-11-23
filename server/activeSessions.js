import { getDb } from './db.js'

const ACTIVE_WINDOW_MS = 5 * 60_000
let indexPromise = null

async function sessions() {
  const db = await getDb('selectors')
  const collection = db.collection('active_sessions')
  if (!indexPromise) {
    indexPromise = Promise.all([
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection.createIndex({ lastSeenAt: 1 }),
    ]).catch((error) => {
      indexPromise = null
      throw error
    })
  }
  await indexPromise
  return collection
}

export async function touchActiveSession(user) {
  if (!user?.id || !user?.jti || !Number.isFinite(Number(user.exp))) return
  const now = new Date()
  const collection = await sessions()
  await collection.updateOne(
    { _id: String(user.jti) },
    {
      $set: {
        userId: String(user.id),
        orgId: user.orgId ? String(user.orgId) : null,
        role: String(user.role || ''),
        lastSeenAt: now,
        expiresAt: new Date(Number(user.exp)),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
}

export async function removeActiveSession(sessionId) {
  if (!sessionId) return
  const collection = await sessions()
  await collection.deleteOne({ _id: String(sessionId) })
}

export async function countActiveUsers(now = new Date()) {
  const collection = await sessions()
  const activeSince = new Date(now.getTime() - ACTIVE_WINDOW_MS)
  const rows = await collection.aggregate([
    {
      $match: {
        lastSeenAt: { $gte: activeSince },
        expiresAt: { $gt: now },
      },
    },
    { $group: { _id: { userId: '$userId', orgId: '$orgId' } } },
    { $count: 'count' },
  ]).toArray()
  return {
    count: Number(rows[0]?.count || 0),
    activeWithinSeconds: ACTIVE_WINDOW_MS / 1000,
    asOf: now.toISOString(),
  }
}
