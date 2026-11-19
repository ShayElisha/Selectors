import { getDb } from './db.js'

let indexPromise

async function collection() {
  const db = await getDb('selectors')
  const col = db.collection('revoked_sessions')
  if (!indexPromise) {
    indexPromise = col
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((error) => {
        indexPromise = null
        throw error
      })
  }
  await indexPromise
  return col
}

export async function revokeSessionId(id, expiresAt) {
  if (!id) return
  const col = await collection()
  await col.updateOne(
    { _id: String(id) },
    { $setOnInsert: { expiresAt: new Date(expiresAt) } },
    { upsert: true },
  )
}

export async function isSessionIdRevoked(id) {
  if (!id) return false
  const col = await collection()
  return Boolean(await col.findOne({ _id: String(id), expiresAt: { $gt: new Date() } }))
}
