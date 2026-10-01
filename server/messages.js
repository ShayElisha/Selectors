import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function publicMessage(doc) {
  return {
    id: String(doc._id),
    title: String(doc.title || ''),
    body: String(doc.body || ''),
    at: String(doc.at || ''),
  }
}

export async function listSystemMessages() {
  const db = await getDb()
  const rows = await db.collection('system_messages').find({}).sort({ at: -1 }).limit(50).toArray()
  return rows.map(publicMessage)
}

export async function createSystemMessage(input) {
  const title = String(input?.title || '').trim().slice(0, 120)
  const body = String(input?.body || '').trim().slice(0, 2000)
  if (title.length < 2) throw httpError('נא לכתוב כותרת', 400)
  if (body.length < 2) throw httpError('נא לכתוב את ההודעה', 400)
  const doc = {
    _id: randomUUID(),
    title,
    body,
    at: new Date().toISOString(),
  }
  const db = await getDb()
  await db.collection('system_messages').insertOne(doc)
  return publicMessage(doc)
}
