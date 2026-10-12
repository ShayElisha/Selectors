import { randomUUID } from 'node:crypto'
import { getSystemErrorCollection } from './db.js'
import { verifySessionToken, getBearerToken } from './session.js'

const SENSITIVE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~-]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g,
]

function cleanText(value, maxLength) {
  let text = String(value || '')
  for (const pattern of SENSITIVE_PATTERNS) text = text.replace(pattern, '[מוסתר]')
  return text.slice(0, maxLength)
}

function actorFromRequest(req) {
  const user = req?.activeUser || verifySessionToken(getBearerToken(req || {}))
  if (!user) return null
  return {
    id: String(user.id || ''),
    role: user.role,
    orgId: user.orgId ? String(user.orgId) : null,
    module: user.module || null,
  }
}

export async function recordSystemError({
  source,
  error,
  status,
  path,
  method,
  actor,
  orgId,
  module,
}) {
  const col = await getSystemErrorCollection()
  const message = cleanText(error?.message || error || 'Unknown error', 1000)
  const stack = cleanText(error?.stack || '', 6000)
  const doc = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    status: Number.isFinite(Number(status)) ? Number(status) : 500,
    method: cleanText(method, 12),
    path: cleanText(path, 200),
    message,
    stack,
    actor: actor || null,
    ...(orgId ? { orgId: String(orgId) } : {}),
    ...(module ? { module: String(module) } : {}),
  }
  await col.insertOne(doc)
  return doc
}

export async function recordServerError(req, error, status) {
  const actor = actorFromRequest(req)
  return recordSystemError({
    source: 'server',
    error,
    status,
    path: req?.path || '',
    method: req?.method || '',
    actor,
    orgId: actor?.orgId,
    module: actor?.module,
  })
}

export async function recordClientError(body, req) {
  const actor = actorFromRequest(req)
  return recordSystemError({
    source: 'client',
    error: {
      message: cleanText(body?.message || 'Client error', 1000),
      stack: cleanText(body?.stack || '', 6000),
    },
    status: 0,
    path: cleanText(body?.path || '', 200),
    method: '',
    actor,
    orgId: actor?.orgId,
    module: actor?.module,
  })
}

export async function listSystemErrors(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const col = await getSystemErrorCollection()
  const [total, items] = await Promise.all([
    col.countDocuments(),
    col
      .find({}, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
  ])
  return { total, offset, limit, items }
}
