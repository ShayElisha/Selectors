import { MongoClient } from 'mongodb'
import { setDefaultResultOrder } from 'node:dns'
import { createSecureContext } from 'node:tls'

// Vercel’s OpenSSL talks to Atlas over IPv6 and gets "tlsv1 alert internal error"
// (alert 80). Force IPv4 and a TLS 1.2 context Atlas accepts.
setDefaultResultOrder('ipv4first')

const URI = process.env.MONGODB_URI

const globalForMongo = globalThis

const atlasTls = createSecureContext({
  minVersion: 'TLSv1.2',
  ciphers: 'DEFAULT:@SECLEVEL=0',
})

export async function getDb() {
  if (!URI) {
    throw new Error('Missing MONGODB_URI')
  }

  if (!globalForMongo.__mongoClientPromise) {
    const client = new MongoClient(URI, {
      family: 4,
      autoSelectFamily: false,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      secureContext: atlasTls,
    })
    globalForMongo.__mongoClientPromise = client.connect()
  }

  const client = await globalForMongo.__mongoClientPromise
  return client.db()
}

export async function getClient() {
  await getDb()
  return globalForMongo.__mongoClientPromise
}

export async function getStateCollection() {
  const db = await getDb()
  return db.collection('app_state')
}

export async function getMetaCollection() {
  const db = await getDb()
  return db.collection('app_meta')
}

export async function getAuditCollection() {
  const db = await getDb()
  return db.collection('audit_logs')
}

/** Run writes together so a save does not leave half the models updated. */
export async function withDbTransaction(fn) {
  const client = await getClient()
  const session = client.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } catch (err) {
    const message = String(err?.message || '')
    const unsupported =
      err?.code === 20 ||
      /transaction numbers are only allowed/i.test(message) ||
      /Transaction numbers/.test(message)
    if (!unsupported) throw err
    return fn(undefined)
  } finally {
    await session.endSession()
  }
}
