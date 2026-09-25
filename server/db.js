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

export async function getStateCollection() {
  const db = await getDb()
  return db.collection('app_state')
}

export async function getAuditCollection() {
  const db = await getDb()
  return db.collection('audit_logs')
}
