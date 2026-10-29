import { MongoClient } from 'mongodb'
import { setDefaultResultOrder } from 'node:dns'
import { createSecureContext } from 'node:tls'

// Prefer IPv4 because Atlas connections from Vercel have failed over IPv6.
setDefaultResultOrder('ipv4first')

const atlasTls = createSecureContext({
  minVersion: 'TLSv1.2',
})

const clientOptions = {
  family: 4,
  autoSelectFamily: false,
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
  secureContext: atlasTls,
}

function store() {
  if (!globalThis.__mongoClients) globalThis.__mongoClients = {}
  return globalThis.__mongoClients
}

/**
 * Selectors and org accounts use MONGODB_URI.
 * Inspectors → MONGODB_URI_INSPECTORS.
 * Security (מאבטחים) → MONGODB_URI_SECURITY.
 */
export function mongoTarget(moduleName) {
  if (moduleName === 'inspectors') return 'inspectors'
  if (moduleName === 'security') return 'security'
  return 'selectors'
}

function uriFor(target) {
  if (target === 'inspectors') {
    const uri = process.env.MONGODB_URI_INSPECTORS?.trim()
    if (!uri) throw new Error('Missing MONGODB_URI_INSPECTORS')
    return uri
  }
  if (target === 'security') {
    const uri = process.env.MONGODB_URI_SECURITY?.trim()
    if (!uri) throw new Error('Missing MONGODB_URI_SECURITY')
    return uri
  }
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) throw new Error('Missing MONGODB_URI')
  return uri
}

export function operationalDbTargets() {
  const targets = ['selectors']
  if (process.env.MONGODB_URI_INSPECTORS?.trim()) targets.push('inspectors')
  if (process.env.MONGODB_URI_SECURITY?.trim()) targets.push('security')
  return targets
}

export async function getClient(target = 'selectors') {
  const key = mongoTarget(target)
  const clients = store()
  if (!clients[key]) {
    const client = new MongoClient(uriFor(key), clientOptions)
    clients[key] = client.connect().then(() => client)
  }
  return clients[key]
}

export async function getDb(target = 'selectors') {
  const client = await getClient(target)
  return client.db()
}

export async function getStateCollection(target = 'selectors') {
  const db = await getDb(target)
  return db.collection('app_state')
}

export async function getMetaCollection(target = 'selectors') {
  const db = await getDb(target)
  return db.collection('app_meta')
}

export async function getAuditCollection(target = 'selectors') {
  const db = await getDb(target)
  return db.collection('audit_logs')
}

export async function getSystemErrorCollection() {
  const db = await getDb('selectors')
  return db.collection('system_errors')
}

/** Run writes together so a save does not leave half the models updated. */
export async function withDbTransaction(fn, target = 'selectors') {
  const client = await getClient(target)
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
