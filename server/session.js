import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

let ephemeralSecret = null

function getSecret() {
  const fromEnv = process.env.SESSION_SECRET?.trim()
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex')
    console.warn(
      '[auth] SESSION_SECRET missing or too short — using ephemeral secret (sessions reset on restart). Set SESSION_SECRET in .env for production.',
    )
  }
  return ephemeralSecret
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

/**
 * @param {{ id: string, fullName: string, phone: string }} user
 * @returns {string}
 */
export function createSessionToken(user) {
  const payload = {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', getSecret()).update(body).digest())
  return `${body}.${sig}`
}

/**
 * @param {string | null | undefined} token
 * @returns {{ id: string, fullName: string, phone: string } | null}
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = b64url(createHmac('sha256', getSecret()).update(body).digest())
  try {
    const a = fromB64url(sig)
    const b = fromB64url(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'))
    if (!payload?.id || !payload?.phone || !payload?.exp) return null
    if (Date.now() > Number(payload.exp)) return null
    return {
      id: String(payload.id),
      fullName: String(payload.fullName || ''),
      phone: String(payload.phone || ''),
    }
  } catch {
    return null
  }
}

/** @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req */
export function getBearerToken(req) {
  const headers = req.headers || {}
  const raw = headers.authorization ?? headers.Authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || typeof value !== 'string') return null
  const m = value.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req
 * @returns {{ id: string, fullName: string, phone: string }}
 */
export function requireUser(req) {
  const user = verifySessionToken(getBearerToken(req))
  if (!user) {
    const err = new Error('נדרשת התחברות')
    err.status = 401
    throw err
  }
  return user
}
