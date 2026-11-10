import { MongoClient } from 'mongodb'
import { setDefaultResultOrder } from 'node:dns'
import { createSecureContext } from 'node:tls'

// Prefer IPv4 because Atlas connections from Vercel have failed over IPv6.
setDefaultResultOrder('ipv4first')

const atlasTls = createSecureContext({
  minVersion: 'TLSv1.2',
})

const baseClientOptions = {
  family: 4,
  autoSelectFamily: false,
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
}

/** Progressive TLS strategies — some Atlas hosts fail one handshake path but accept another. */
function connectStrategies() {
  return [
    { ...baseClientOptions, secureContext: atlasTls },
    { ...baseClientOptions },
    {
      ...baseClientOptions,
      tls: true,
      serverSelectionTimeoutMS: 12000,
      connectTimeoutMS: 12000,
    },
  ]
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

export function isDbTlsError(detail) {
  return /tlsv1 alert internal error|SSL alert number 80|EPROTO|ssl3_read_bytes|wrong version number|SSL routines|SSL alert|certificate|CERT_|UNABLE_TO_VERIFY|mongodb.*tls|TLS handshake/i.test(
    String(detail || ''),
  )
}

function targetLabel(target) {
  if (target === 'security') return 'מאבטחים'
  if (target === 'inspectors') return 'בודקים'
  return 'סלקטורים'
}

function envHint(target) {
  if (target === 'security') return 'MONGODB_URI_SECURITY'
  if (target === 'inspectors') return 'MONGODB_URI_INSPECTORS'
  return 'MONGODB_URI'
}

/** Never expose raw OpenSSL dumps to API clients. */
export function mapDbError(err, target = 'selectors') {
  const detail = err instanceof Error ? err.message : String(err || '')
  if (/Missing MONGODB_URI/i.test(detail)) {
    const mapped = new Error(
      `חסר משתנה סביבה ${envHint(mongoTarget(target))} לחיבור מסד הנתונים`,
    )
    mapped.status = 503
    mapped.cause = err
    return mapped
  }
  if (isDbTlsError(detail) || /MongoNetwork|Server selection timed out|ECONNREFUSED|ENOTFOUND|ETIMEOUT/i.test(detail)) {
    const mapped = new Error(
      `חיבור למסד הנתונים של ${targetLabel(mongoTarget(target))} נכשל זמנית. נסו שוב בעוד רגע.`,
    )
    mapped.status = 503
    mapped.cause = err
    return mapped
  }
  if (err && typeof err === 'object' && err.status) return err
  const mapped = new Error('שגיאת מסד נתונים')
  mapped.status = 500
  mapped.cause = err
  return mapped
}

async function connectOnce(uri, options) {
  const client = new MongoClient(uri, options)
  try {
    await client.connect()
    return client
  } catch (err) {
    try {
      await client.close()
    } catch {
      /* ignore close errors after failed connect */
    }
    throw err
  }
}

async function connectWithRetries(target) {
  const uri = uriFor(target)
  const strategies = connectStrategies()
  let lastError = null
  for (let i = 0; i < strategies.length; i++) {
    try {
      return await connectOnce(uri, strategies[i])
    } catch (err) {
      lastError = err
      const detail = err instanceof Error ? err.message : String(err)
      console.error(
        `[db] connect failed target=${target} attempt=${i + 1}/${strategies.length}`,
        detail,
      )
      // Only rotate TLS strategies for handshake / network class errors.
      if (!isDbTlsError(detail) && !/MongoNetwork|Server selection timed out|ECONNREFUSED|ENOTFOUND|ETIMEOUT/i.test(detail)) {
        break
      }
    }
  }
  throw mapDbError(lastError, target)
}

export async function getClient(target = 'selectors') {
  const key = mongoTarget(target)
  const clients = store()
  if (!clients[key]) {
    clients[key] = connectWithRetries(key).catch((err) => {
      // Drop rejected promise so the next request can retry a fresh connect.
      delete clients[key]
      throw err instanceof Error && err.status ? err : mapDbError(err, key)
    })
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
