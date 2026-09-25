import { MongoClient } from 'mongodb'

const URI = process.env.MONGODB_URI

const globalForMongo = globalThis

export async function getDb() {
  if (!URI) {
    throw new Error('Missing MONGODB_URI')
  }

  if (!globalForMongo.__mongoClientPromise) {
    const client = new MongoClient(URI)
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
